/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { makeRange } from "@components/PluginSettings/components";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { findByCodeLazy, findLazy } from "@webpack";
import { Button, Card, Forms, React, Select, Slider, Switch, useRef } from "@webpack/common";
import { ComponentType, Ref, SyntheticEvent } from "react";

import { SoundOverride, SoundPlayer, SoundType } from "../types";

type FileInput = ComponentType<{
    ref: Ref<HTMLInputElement>;
    onChange: (e: SyntheticEvent<HTMLInputElement>) => void;
    multiple?: boolean;
    filters?: { name?: string; extensions: string[]; }[];
}>;

const playSound: (id: string) => SoundPlayer = findByCodeLazy(".playWithListener().then");
const FileInput: FileInput = findLazy(m => m.prototype?.activateUploadDialogue && m.prototype.setRef);
const cl = classNameFactory("vc-custom-sounds-");

const isValidAudioUrl = (url: string) => {
    if (!url) return false;
    if (url.startsWith("data:audio/")) return true;
    const audioExtensions = [".mp3", ".wav", ".ogg", ".webm", ".flac"];
    return audioExtensions.some(ext => url.toLowerCase().endsWith(ext));
};

const processUrl = (url: string) => {
    if (!url) return "";
    if (url.includes("github.com") && !url.includes("raw.githubusercontent.com")) {
        return url.replace("github.com", "raw.githubusercontent.com")
            .replace("/blob/", "/");
    }
    return url;
};

export function SoundOverrideComponent({ type, override, onChange, overrides }: {
    type: SoundType;
    override: SoundOverride;
    onChange: () => Promise<void>;
    overrides: Record<string, SoundOverride>;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sound = useRef<SoundPlayer | null>(null);
    const update = useForceUpdater();

    const soundOptions = [
        { value: "original", label: "Original" },
        { value: "custom", label: "Custom" }
    ];

    if (type.seasonal) {
        if (type.seasonal.some(id => id.startsWith("halloween_"))) {
            soundOptions.push({ value: "halloween", label: "Halloween" });
        }
        if (type.seasonal.some(id => id.startsWith("winter_"))) {
            soundOptions.push({ value: "winter", label: "Winter" });
        }
    }

    const [selectedSound, setSelectedSound] = React.useState({
        value: override.selectedSound ?? "original",
        label: soundOptions.find(opt => opt.value === (override.selectedSound ?? "original"))?.label ?? "Original"
    });

    const renderSoundUploader = (currentOverride: SoundOverride) => (
        <>
            <Forms.FormTitle>Replacement Sound</Forms.FormTitle>
            <div className={Margins.bottom16}>
                <Button
                    color={Button.Colors.PRIMARY}
                    disabled={!override.enabled}
                    className={classes(Margins.right8, cl("upload"))}
                >
                    Upload File
                    <FileInput
                        ref={fileInputRef}
                        onChange={event => {
                            event.stopPropagation();
                            event.preventDefault();
                            if (!event.currentTarget?.files?.length) return;
                            const { files } = event.currentTarget;
                            const file = files[0];
                            const reader = new FileReader;
                            reader.onload = () => {
                                currentOverride.url = reader.result as string;
                                onChange();
                                update();
                            };
                            reader.readAsDataURL(file);
                        }}
                        filters={[{ extensions: ["mp3", "wav", "ogg", "webm", "flac"] }]}
                    />
                </Button>
                <Button
                    color={Button.Colors.RED}
                    onClick={() => {
                        currentOverride.url = "";
                        onChange();
                        update();
                    }}
                    disabled={!(override.enabled && currentOverride.url.length !== 0)}
                    style={{ display: "inline" }}
                >
                    Clear
                </Button>
            </div>
            <Forms.FormText className={Margins.bottom8}>
                <input
                    type="text"
                    value={currentOverride.url?.startsWith("data:") ? "" : currentOverride.url}
                    onChange={e => {
                        const processedUrl = processUrl(e.target.value);
                        currentOverride.url = processedUrl;
                        onChange();
                        update();
                    }}
                    placeholder="https://example.com/sound.mp3"
                    className={classes(Margins.bottom16, cl("url-input"))}
                />
            </Forms.FormText>
            <Forms.FormTitle>Volume</Forms.FormTitle>
            <Slider
                markers={makeRange(0, 100, 10)}
                initialValue={currentOverride.volume}
                onValueChange={value => {
                    currentOverride.volume = value;
                    onChange();
                    update();
                }}
                className={Margins.bottom16}
                disabled={!override.enabled}
            />
        </>
    );

    const getSeasonalId = (season: string) => {
        if (!type.seasonal) return null;
        return type.seasonal.find(id => id.startsWith(`${season}_`));
    };

    const previewSound = () => {
        if (sound.current != null)
            sound.current.stop();

        if (selectedSound.value === "original") {
            sound.current = playSound(type.id);
        } else if (selectedSound.value === "halloween" || selectedSound.value === "winter") {
            const soundId = getSeasonalId(selectedSound.value);
            if (soundId) sound.current = playSound(soundId);
        } else if (selectedSound.value === "custom" && override.enabled) {
            const processedUrl = processUrl(override.url);
            if (isValidAudioUrl(processedUrl)) {
                const audio = new Audio(processedUrl);
                audio.volume = override.volume / 100;
                audio.play();
                sound.current = {
                    play: () => audio.play(),
                    pause: () => audio.pause(),
                    stop: () => { audio.pause(); audio.currentTime = 0; },
                    loop: () => { audio.loop = true; }
                };
            } else {
                sound.current = playSound(type.id);
            }
        }
    };

    return (
        <Card className={cl("card")}>
            <Switch
                value={override.enabled}
                onChange={value => {
                    override.enabled = value;
                    onChange();
                    update();
                }}
                className={Margins.bottom16}
                hideBorder={true}
            >
                {type.name} <span className={cl("id")}>({type.id})</span>
            </Switch>

            <>
                <Button
                    color={Button.Colors.PRIMARY}
                    className={Margins.bottom16}
                    onClick={previewSound}
                >
                    Preview
                </Button>

                <Forms.FormTitle>Sound Type</Forms.FormTitle>
                <Select
                    options={soundOptions}
                    select={value => {
                        const option = soundOptions.find(opt => opt.value === value) ?? soundOptions[0];
                        setSelectedSound(option);
                        override.selectedSound = option.value;
                        onChange();
                        update();
                    }}
                    isSelected={value => value === selectedSound.value}
                    serialize={option => option.value}
                    className={Margins.bottom16}
                />

                {selectedSound.value === "custom" && renderSoundUploader(override)}
            </>
        </Card>
    );
}
