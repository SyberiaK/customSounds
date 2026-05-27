/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { chooseFile, saveFile } from "@utils/web";
import { MessageJSON, RenderModalProps } from "@vencord/discord-types";
import { ConfirmModal, openModal, React, showToast, TextInput, Toasts, UserStore } from "@webpack/common";

import * as AudioStore from "./audioStore";
import { LRU } from "./cache";
import { SoundOverrideComponent } from "./SoundOverrideComponent";
import { ExportedAudioFile, makeEmptyOverride, SettingsExport, SOUND_TYPES, SoundOverride } from "./types";

// todo: is aac actually supported in any browser?
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "aac", "flac", "webm", "wma", "mp4", "opus"];
const MAX_FILE_SIZE_MB = 30; // at 320 kbps = 12:30 of music, there is no way you'd need more
const HEAVY_EXPORT_THRESHOLD_MB = 100;

const audioExtensionsString = AUDIO_EXTENSIONS.map(v => `.${v}`).join(", ");

const cl = classNameFactory("vc-custom-sounds-");

const allSoundTypes = SOUND_TYPES || [];

const dataUriCache = new LRU();
const logger = new Logger("CustomSounds");

function getOverride(id: string): SoundOverride {
    const stored = settings.store[id];
    if (!stored) return makeEmptyOverride();

    if (typeof stored === "object") return stored;

    try {
        return JSON.parse(stored);
    } catch {
        return makeEmptyOverride();
    }
}

function setOverride(id: string, override: SoundOverride): void {
    settings.store[id] = JSON.stringify(override);
}

export function getCustomSoundURL(id: string): string | null {
    const override = getOverride(id);

    if (!override?.enabled || override.selectedSound === "default") return null;

    if (override.selectedSound === "custom" && override.selectedFileId) {
        return dataUriCache.get(override.selectedFileId) ?? null;
    }

    const soundType = allSoundTypes.find(t => t.id === id);
    return soundType?.seasonal?.[override.selectedSound] ?? null;
}

export async function ensureDataURICached(fileId: string): Promise<string | null> {
    const cached = dataUriCache.get(fileId);
    if (cached) return cached;

    const dataUri = await AudioStore.getAudioDataURI(fileId);
    if (dataUri) {
        try {
            dataUriCache.set(fileId, dataUri);
            return dataUri;
        } catch (error) {
            logger.error(`Error loading audio for ${fileId}:`, error);
        }
    }

    return null;
}

export async function refreshDataURI(id: string): Promise<void> {
    const override = getOverride(id);
    if (!override?.selectedFileId) return;

    await ensureDataURICached(override.selectedFileId);
}

async function preloadDataURIs(): Promise<void> {
    const fileIdsToPreload = new Set<string>(
        allSoundTypes
            .map(soundType => getOverride(soundType.id))
            .filter(override => override?.enabled && override.selectedSound === "custom" && override.selectedFileId)
            .map(override => override.selectedFileId!)
    );

    if (fileIdsToPreload.size === 0) return;
    for (const fileId of fileIdsToPreload) await ensureDataURICached(fileId);

    logger.info(`Preloaded ${fileIdsToPreload.size} custom sounds`);
}

const soundSettings = Object.fromEntries(
    allSoundTypes.map(type => [
        type.id,
        {
            type: OptionType.STRING,
            description: `Override for ${type.name}`,
            default: JSON.stringify(makeEmptyOverride()),
            hidden: true
        }
    ])
);

function SkipFileModal({ modalProps, filename, resolve }: { modalProps: RenderModalProps; filename: string; resolve: (value: [boolean, boolean]) => void; }) {
    const [repeatForAll, setRepeatForAll] = React.useState(false);
    return (
        <ConfirmModal
            {...modalProps}
            title="The file already exists"
            subtitle={`You already have a file named "${filename}" uploaded.`}
            confirmText="Skip"
            cancelText="Replace"
            checkboxProps={{
                label: "Do for all",
                checked: repeatForAll === true,
                onChange: checked => setRepeatForAll(checked)
            }}
            onConfirm={() => { resolve([true, repeatForAll]); }}
            onCancel={() => { resolve([false, repeatForAll]); }}
        />
    );
}

function resolveSkipFileModal(filename: string) {
    return new Promise<[boolean, boolean]>(resolve => {
        openModal(props => <SkipFileModal modalProps={props} filename={filename} resolve={resolve} />);
    });
}

function SoundOverrides() {
    const [searchQuery, setSearchQuery] = React.useState("");
    const [files, setFiles] = React.useState<Record<string, AudioStore.AudioFileMetadata>>({});
    const [filesLoaded, setFilesLoaded] = React.useState(false);
    const audioFilesInputRef = React.useRef<HTMLInputElement>(null); // todo: implement chooseFiles?

    const loadFiles = React.useCallback(async () => {
        const metadata = await AudioStore.getAllAudioMetadata();
        setFiles(metadata);
        setFilesLoaded(true);
    }, []);

    React.useEffect(() => {
        allSoundTypes.forEach(type => {
            if (!settings.store[type.id]) {
                setOverride(type.id, makeEmptyOverride());
            }
        });
        loadFiles();
    }, []);

    function removeFilesModal() {
        openModal(props => (
            <ConfirmModal
                {...props}
                title="Are you sure?"
                subtitle={`This will remove ${Object.keys(files).length} file${Object.keys(files).length !== 1 ? "s" : ""} imported into the plugin.`}
                confirmText="Remove"
                onConfirm={removeAllFiles}
            />
        ));
    }

    const removeAllFiles = async () => {
        await AudioStore.clearStore();
        dataUriCache.clear();

        const empty = makeEmptyOverride();
        allSoundTypes.forEach(type => {
            const override = getOverride(type.id);
            override.selectedFileId = empty.selectedFileId;
            setOverride(type.id, override);
        });

        await loadFiles();

        showToast("Files removed successfully.", Toasts.Type.SUCCESS);
    };

    const resetOverrides = () => {
        allSoundTypes.forEach(type => setOverride(type.id, makeEmptyOverride()));
    };

    const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = event.target.files;
        if (!selectedFiles) return;

        showToast(selectedFiles.length > 1 ? `Uploading ${selectedFiles.length} files...` : "Uploading file...");

        const filteredFiles: File[] = [];
        for (const file of selectedFiles) {
            if (!file) continue;

            const fileExtension = file.name.split(".").pop()?.toLowerCase();
            if (!fileExtension || !AUDIO_EXTENSIONS.includes(fileExtension)) {
                showToast(`Invalid file type of "${file.name}". Please upload only audio files (${audioExtensionsString}).`, Toasts.Type.FAILURE);
                continue;
            }
            filteredFiles.push(file);
        }

        const audioDataToSave: [AudioStore.StoredAudioFile, AudioStore.AudioFileMetadata][] = [];
        let doSkip = false;
        let repeatForAll = false;

        for (const file of filteredFiles) {
            try {
                const [data, metadata] = await AudioStore.processAudioFile(file);

                if (files[data.id]) {
                    if (doSkip && repeatForAll) continue;

                    const existingDataUri = await AudioStore.getAudioDataURI(data.id);
                    if (existingDataUri === data.dataUri) continue;

                    if (!repeatForAll) {
                        [doSkip, repeatForAll] = await resolveSkipFileModal(data.name);
                    }
                }

                if (!doSkip) audioDataToSave.push([data, metadata]);
            } catch (error: any) {
                logger.error("Upload error:", error);
                const message = error.message ?? "Unknown error";
                showToast(message.includes("too large") ? message : `Upload of "${file.name}" failed: ${message}`, Toasts.Type.FAILURE);
                continue;
            }
        }

        await AudioStore.saveAudioData(audioDataToSave);
        for (const [data] of audioDataToSave) await ensureDataURICached(data.id);

        await loadFiles();
        showToast(`Added ${audioDataToSave.length} file${audioDataToSave.length !== 1 ? "s" : ""}.`, Toasts.Type.SUCCESS);
        event.target.value = "";
    };

    const handleSettingsUpload = async () => {
        const file = await chooseFile(".json");

        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e: ProgressEvent<FileReader>) => {
            resetOverrides();

            try {
                const imported: SettingsExport = JSON.parse(e.target?.result as string);

                // have to keep track of those because `files` gets updated after
                const newlyAddedAudioIDs: string[] = [];
                if (Array.isArray(imported?.files)) {
                    const audioDataToSave: [AudioStore.StoredAudioFile, AudioStore.AudioFileMetadata][] = [];

                    let doSkip = false;
                    let repeatForAll = false;
                    for (const importedFile of imported.files) {
                        if (!importedFile?.name || !importedFile?.dataUri) continue;

                        try {
                            const [data, metadata] = await AudioStore.importAudioData(importedFile);

                            if (files[data.id]) {
                                if (doSkip && repeatForAll) continue;

                                const dataUri = await AudioStore.getAudioDataURI(data.id);
                                if (dataUri === data.dataUri) continue;

                                if (!repeatForAll) {
                                    [doSkip, repeatForAll] = await resolveSkipFileModal(data.name);
                                }
                            }

                            if (!doSkip) {
                                audioDataToSave.push([data, metadata]);
                                newlyAddedAudioIDs.push(data.id);
                            }
                        } catch (error: any) {
                            logger.error("Import error:", error);
                            const message = error.message ?? "Unknown error";
                            showToast(message.includes("too large") ? message : `Import of "${importedFile.name}" failed: ${message}`, Toasts.Type.FAILURE);
                            continue;
                        }
                    }

                    await AudioStore.saveAudioData(audioDataToSave);
                    for (const [data] of audioDataToSave) await ensureDataURICached(data.id);

                    await loadFiles();

                    showToast(`Added ${audioDataToSave.length} file${audioDataToSave.length !== 1 ? "s" : ""}.`, Toasts.Type.SUCCESS);
                }

                const empty = makeEmptyOverride();
                const filesMissing: ({ id: string; } & SoundOverride)[] = [];
                if (Array.isArray(imported?.overrides)) {
                    for (const setting of imported.overrides) {
                        if (!setting.id) continue;

                        const override: SoundOverride = {
                            enabled: setting.enabled ?? empty.enabled,
                            selectedSound: setting.selectedSound ?? empty.selectedSound,
                            selectedFileId: setting.selectedFileId ?? empty.selectedFileId,
                            volume: setting.volume ?? empty.volume,
                        };
                        setOverride(setting.id, override);

                        if (!setting.selectedFileId) continue;
                        if (!files[setting.selectedFileId] && !newlyAddedAudioIDs.includes(setting.selectedFileId)) filesMissing.push(setting);

                        await ensureDataURICached(setting.selectedFileId);
                    }
                }

                if (filesMissing.length !== 0) {
                    openModal(props => (
                        <ConfirmModal
                            {...props}
                            title="Audio files not found"
                            subtitle={`Seems like some custom audio files are missing: ${filesMissing.map(setting => setting.selectedFileId).join(", ")}.
                                        Do you want to add missing files?`}
                            confirmText="Yes"
                            cancelText="No"
                            onConfirm={() => { audioFilesInputRef.current?.click(); }}
                            onCancel={() => {
                                filesMissing.forEach(setting => {
                                    const override: SoundOverride = {
                                        enabled: setting.enabled,
                                        selectedSound: setting.selectedSound,
                                        selectedFileId: empty.selectedFileId,
                                        volume: setting.volume,
                                    };
                                    setOverride(setting.id, override);
                                });
                            }}
                        />
                    ));
                }

                showToast("Settings imported successfully!", Toasts.Type.SUCCESS);
            } catch (e: unknown) {
                if (e instanceof SyntaxError) {
                    showToast("Error importing settings: the file is not valid JSON.", Toasts.Type.FAILURE);
                } else {
                    showToast("Error importing settings. Check console for details.", Toasts.Type.FAILURE);
                    logger.error("Error importing settings:", e);
                }
            }
        };

        reader.readAsText(file);
    };

    const downloadSettings = async () => {
        const overrides = allSoundTypes.map(type => {
            const override = getOverride(type.id);
            return {
                id: type.id,
                enabled: override.enabled,
                selectedSound: override.selectedSound,
                selectedFileId: override.selectedFileId ?? undefined,
                volume: override.volume
            };
        }).filter(o => o.enabled || o.selectedSound !== "default");

        const allFiles = new Set(Object.keys(files));
        let usedFiles = new Set<string>(
            Object.values(overrides)
                .filter(o => o.selectedFileId)
                .map(o => o.selectedFileId!)
        );

        if (allFiles.size > usedFiles.size) {
            const includeAll = await new Promise((resolve: (value: boolean) => void) => openModal(props => (
                <ConfirmModal
                    {...props}
                    title="Some of files are unused"
                    subtitle={"Some of the files are unused in your overrides. Do you want to include them in the export output?"}
                    confirmText="Yes"
                    cancelText="No"
                    onConfirm={() => { resolve(true); }}
                />
            )));
            if (includeAll) usedFiles = allFiles;
        }

        const totalSize = Array.from(usedFiles).reduce((acc, val) => acc + files[val].size, 0);
        if (totalSize > HEAVY_EXPORT_THRESHOLD_MB * 1024 * 1024) { // tod
            const proceed = await new Promise((resolve: (value: boolean) => void) => openModal(props => (
                <ConfirmModal
                    {...props}
                    title="The export is too heavy"
                    subtitle={`The total size of exported files exceeds 100MB (${(totalSize / 1024 / 1024).toFixed(1)}MB).
                                    Exporting (and importing) so much data might take a while to process or evem cause your Discord client to crash.
                                    Do you wish to proceed?`}
                    confirmText="Yes"
                    cancelText="No"
                    onConfirm={() => { resolve(true); }}
                />
            )));
            if (!proceed) return;
        }

        const audioData = await AudioStore.getAllAudio();
        const filesToBundle: ExportedAudioFile[] = [];
        for (const fileId of usedFiles) {
            const file = audioData[fileId];
            if (!file?.dataUri) continue;

            filesToBundle.push(file);
        }

        const exportPayload: SettingsExport = {
            overrides,
            files: filesToBundle
        };

        showToast(`Exporting ${overrides.length} settings and ${filesToBundle.length} files...`);

        const file = new File(
            [JSON.stringify(exportPayload, null, 2)],
            "customSounds-settings.json",
            { type: "application/json" }
        );
        saveFile(file);
    };

    const filteredSoundTypes = allSoundTypes.filter(type =>
        type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        type.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={cl("main")}>
            <div className={cl("section")}>
                <Heading>Custom Audio Files</Heading>
                <div className={cl("buttons")}>
                    <Button variant="positive" onClick={() => audioFilesInputRef.current?.click()}>Add</Button>
                    <Button
                        disabled={Object.keys(files).length === 0}
                        variant="dangerPrimary"
                        onClick={removeFilesModal}
                    >
                        Remove All</Button>
                    <input
                        ref={audioFilesInputRef}
                        type="file"
                        accept={audioExtensionsString}
                        multiple
                        style={{ display: "none" }}
                        onChange={uploadFiles}
                    />
                </div>
            </div>
            <div className={cl("section")}>
                <Heading>Overrides</Heading>
                <div className={cl("buttons")}>
                    <Button variant="primary" onClick={handleSettingsUpload}>Import</Button>
                    <Button variant="secondary" onClick={downloadSettings}>Export</Button>
                    <Button variant="dangerPrimary" onClick={() => {
                        resetOverrides();
                        showToast("All overrides reset successfully!", Toasts.Type.SUCCESS);
                    }}
                    >
                        Reset All</Button>
                </div>
            </div>
            <div className={cl("search")}>
                <Heading>Search Sounds</Heading>
                <TextInput
                    value={searchQuery}
                    onChange={(e: string) => setSearchQuery(e)}
                    placeholder="Search by name or ID"
                />
            </div>

            {!filesLoaded ? (
                <Paragraph>Loading audio files...</Paragraph>
            ) : (
                <div className={cl("sounds-list")}>
                    {filteredSoundTypes.map(type => {
                        const currentOverride = getOverride(type.id);

                        if (currentOverride.selectedFileId &&
                            !files[currentOverride.selectedFileId]) {
                            currentOverride.selectedFileId = undefined;
                            // setOverride(type.id, currentOverride);  // todo: breaks "file missing" prompt
                        }

                        return (
                            <SoundOverrideComponent
                                key={type.id}
                                type={type}
                                override={currentOverride}
                                files={files}
                                onFilesChange={loadFiles}
                                onChange={async () => {
                                    setOverride(type.id, currentOverride);

                                    if (currentOverride.enabled &&
                                        currentOverride.selectedSound === "custom" &&
                                        currentOverride.selectedFileId) {
                                        await ensureDataURICached(currentOverride.selectedFileId);
                                    }
                                }}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}

const settings = definePluginSettings({
    ...soundSettings,
    overrides: {
        type: OptionType.COMPONENT,
        description: "",
        component: SoundOverrides
    }
});

export function isOverriden(id: string): boolean {
    return !!getOverride(id)?.enabled;
}

export function mentionsEveryone(message: MessageJSON): boolean {
    return message.mention_everyone;
}

export function mentionsMe(message: MessageJSON): boolean {
    return message.mentions.some(m => m.id === UserStore.getCurrentUser().id);
}

export function findOverride(id: string): SoundOverride | null {
    const override = getOverride(id);
    return override?.enabled ? override : null;
}

export default definePlugin({
    name: "CustomSounds",
    description: "Customize Discord's sounds.",
    authors: [{ name: "SyberiaK", id: 355270337702920192n }, Devs.ScattrdBlade, Devs.TheKodeToad],
    settings,
    patches: [
        {
            find: 'Error("could not play audio")',
            replacement: [
                {
                    match: /(?<=new Audio;\i\.src=)\i\([0-9]+\)\(`\.\/\$\{this\.name\}\.mp3`\)/,
                    replace: "(() => { const customUrl = $self.getCustomSoundURL(this.name); return customUrl || $& })()"
                },
                {
                    match: /Math.min\(\i\.\i\.getOutputVolume\(\)\/100\*this\._volume/,
                    replace: "$& * ($self.findOverride(this.name)?.volume ?? 100) / 100"
                }
            ]
        },
        {
            find: ".playWithListener().then",
            replacement: {
                match: /\i\.\i\.getSoundpack\(\)/,
                replace: '$self.isOverriden(arguments[0]) ? "classic" : $&'
            }
        },
        {
            find: ".connectHasStarted",
            replacement: {
                match: /return;return"user_join"/,
                replace: 'return;return $self.isOverriden("connect") ? "connect" : "user_join"'
            }
        },
        {
            find: ".getDesktopType()===",
            replacement: [
                {
                    match: /sound:(\i\?\i:void 0,volume:\i,onClick)/,
                    replace: 'sound: $self.mentionsEveryone(arguments[0]?.message) && $self.isOverriden("mention2") ? "mention2" : $self.mentionsMe(arguments[0]?.message) && $self.isOverriden("user_mentioned") ? "user_mentioned" : $1'
                }
            ]
        }
    ],
    findOverride,
    isOverriden,
    getCustomSoundURL,
    refreshDataURI,
    ensureDataURICached,
    mentionsEveryone,
    mentionsMe,
    startAt: StartAt.Init,

    async start() {
        AudioStore.setMaxFileSizeMB(MAX_FILE_SIZE_MB);
        dataUriCache.setSizeLimit(MAX_FILE_SIZE_MB);

        await preloadDataURIs();
    },
    async stop() {
        dataUriCache.clear();
    }
});
