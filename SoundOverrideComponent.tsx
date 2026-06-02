/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { makeRange } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { React, Select, showToast, Slider } from "@webpack/common";

import * as AudioStore from "./audioStore";
import { makeEmptyOverride, SoundOverride, SoundPlayer, SoundType } from "./types";

const cl = classNameFactory("vc-custom-sounds-");
const logger = new Logger("CustomSounds");
const playSound: (id: string) => SoundPlayer = findByCodeLazy(".playWithListener().then");

const capitalizeWords = (str: string) =>
    str.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export function SoundOverrideComponent({ type, override, onChange, files, onFilesChange }: {
    type: SoundType;
    override: SoundOverride;
    onChange: () => Promise<void>;
    files: Record<string, AudioStore.AudioMetadata>;
    onFilesChange: () => void;
}) {
    const sound = React.useRef<SoundPlayer | null>(null);

    React.useEffect(() => {
        return () => {
            sound.current?.stop();
            sound.current = null;
        };
    }, []);

    const previewSound = async () => {
        sound.current?.stop();

        if (!override.enabled) {
            sound.current = playSound(type.derived ?? type.id);
            return;
        }

        const { selectedSound, selectedFileId } = override;

        if (selectedSound === "default") {
            sound.current = playSound(type.derived ?? type.id);
            return;
        }
        if (selectedSound !== "custom") {
            sound.current = playSound(selectedSound);
            return;
        }
        if (!selectedFileId) {
            sound.current = playSound(type.derived ?? type.id);
            return;
        }

        const dataUri = await AudioStore.getAudioDataURI(selectedFileId);

        if (!dataUri || !dataUri.startsWith("data:audio/")) {
            showToast("No custom sound file available for preview");
            return;
        }

        const mimeType = dataUri.match(/^data:(audio\/[^;,]+)/i)?.[1] ?? "audio/mpeg";
        const testEl = document.createElement("audio");
        if (!testEl.canPlayType(mimeType)) {
            showToast("Your browser doesn't support this format. Try re-uploading as MP3 or WAV.");
            return;
        }

        const audio = new Audio(dataUri);
        audio.volume = override.volume / 100;

        audio.onerror = () => {
            const msg = audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                ? "Format not supported by browser. Try MP3 or WAV."
                : "Could not play file. It may be corrupted or in an unsupported format.";
            showToast(msg);
            logger.error("Error handled in previewSound:", audio.error?.message);
        };

        try {
            await audio.play();
            sound.current = {
                play: () => audio.play(),
                pause: () => audio.pause(),
                stop: () => {
                    audio.pause();
                    audio.currentTime = 0;
                },
                loop: () => { audio.loop = true; }
            };
        } catch (e) {
            const err = e as Error;
            const msg = err?.name === "NotSupportedError" || err?.message?.includes("supported source")
                ? "Format not supported by browser. Try MP3 or WAV."
                : "Could not play file. It may be corrupted or in an unsupported format.";
            showToast(msg);
            logger.error("Error in previewSound:", e);
        }
    };

    const deleteFile = async (id: string) => {
        await AudioStore.deleteAudio(id);

        if (override.selectedFileId === id) {
            override.selectedFileId = makeEmptyOverride().selectedFileId;
            await onChange();
        }
        onFilesChange();
        showToast("File deleted successfully");
    };

    const customFileOptions = Object.entries(files)
        .filter(([id, file]) => !!id && !!file?.name)
        .map(([id, file]) => ({
            value: id,
            label: file.name
        }));

    return (
        <Card className={cl("card")}>
            <FormSwitch
                title={type.name}
                value={override.enabled || false}
                onChange={async val => {
                    override.enabled = val;
                    onChange();
                }}
                hideBorder
            />

            {override.enabled && (
                <div className={cl("card-content")}>
                    <div className={cl("buttons")}>
                        <Button variant="positive" size="iconOnly" onClick={previewSound}>▶</Button>
                        <Button
                            variant="dangerPrimary"
                            size="iconOnly"
                            onClick={() => sound.current?.stop()}
                        >
                            ⏹
                        </Button>
                    </div>
                    <div className={cl("card-option")}>
                        <Heading>Volume</Heading>
                        <Slider
                            markers={makeRange(0, 100, 10)}
                            initialValue={override.volume}
                            onValueChange={val => {
                                override.volume = val;
                                onChange();
                            }}
                        />
                    </div>
                    <div className={cl("card-option")}>
                        <Heading>Sound Source</Heading>
                        <Select
                            options={[
                                { value: "default", label: "Default" },
                                ...(Object.keys(type.seasonal ?? {}).map(id => ({ value: id, label: capitalizeWords(id) }))),
                                { value: "custom", label: "Custom" }
                            ]}
                            isSelected={v => v === override.selectedSound}
                            select={async v => {
                                override.selectedSound = v;
                                onChange();
                            }}
                            serialize={opt => opt.value}
                        />
                    </div>

                    {override.selectedSound === "custom" && (
                        <div className={cl("card-option")}>
                            <Heading>Custom File</Heading>
                            <Select
                                options={[
                                    { value: "", label: "Select a file..." },
                                    ...customFileOptions
                                ]}
                                isSelected={v => v === (override.selectedFileId || "")}
                                select={async id => {
                                    override.selectedFileId = id || undefined;
                                    onChange();
                                }}
                                serialize={opt => opt.value}
                            />
                            <Button
                                variant="dangerPrimary"
                                onClick={() => deleteFile(override.selectedFileId!)}
                                disabled={!override.selectedFileId || !files[override.selectedFileId]}
                            >
                                Remove Selected Sound
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
