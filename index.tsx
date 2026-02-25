/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { useForceUpdater } from "@utils/react";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { saveFile } from "@utils/web";
import { Alerts, React, showToast, TextInput } from "@webpack/common";

import * as AudioStore from "./audioStore";
import { SoundOverrideComponent } from "./SoundOverrideComponent";
import { makeEmptyOverride, SEASONAL_SOUNDS, SOUND_TYPES, SoundOverride } from "./types";

const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "aac", "flac", "webm", "wma", "mp4"];
const audioExtensionsString = AUDIO_EXTENSIONS.map(v => `.${v}`).join(", ");

const cl = classNameFactory("vc-custom-sounds-");

const allSoundTypes = SOUND_TYPES || [];

const MIN_CACHE_SIZE_MB_CAP = 5;
const MAX_CACHE_SIZE_MB_CAP = 500;

// LRU-style cache with dynamic size limit based on max file size setting
const MAX_FILES_CACHED_AT_MAX_SIZE = 5;
const BASE64_OVERHEAD = 1.37;
const CACHE_SIZE_MULTIPLIER = BASE64_OVERHEAD * MAX_FILES_CACHED_AT_MAX_SIZE;

let maxCacheSizeBytes = 100 * 1024 * 1024; // Default 100MB, updated on start
const dataUriCache = new Map<string, string>();
let currentCacheSize = 0;

function updateCacheLimit(maxFileSizeMB: number): void {
    // calculate for 5 files at max size (accounting for base64 overhead)
    const calculatedSize = Math.round(maxFileSizeMB * CACHE_SIZE_MULTIPLIER);
    maxCacheSizeBytes = Math.min(Math.max(calculatedSize, MIN_CACHE_SIZE_MB_CAP), MAX_CACHE_SIZE_MB_CAP) * 1024 * 1024;
}

function addToCache(fileId: string, dataUri: string): void {
    const uriSize = dataUri.length;

    if (uriSize > maxCacheSizeBytes) {
        console.warn(`[CustomSounds] File too large to cache (${Math.round(uriSize / (1024 * 1024))}MB > ${Math.round(maxCacheSizeBytes / (1024 * 1024))}MB limit)`);
        return;
    }

    // Evict oldest entries if needed (maintain insertion order)
    while (currentCacheSize + uriSize > maxCacheSizeBytes && dataUriCache.size > 0) {
        const oldestKey = dataUriCache.keys().next().value;

        // todo: isn't `dataUriCache.size > 0` there to ensure at least one key is present?
        if (oldestKey) {
            const oldestSize = dataUriCache.get(oldestKey)?.length || 0;
            dataUriCache.delete(oldestKey);
            currentCacheSize -= oldestSize;
        }
    }

    dataUriCache.set(fileId, dataUri);
    currentCacheSize += uriSize;
}

function getFromCache(fileId: string): string | undefined {
    const dataUri = dataUriCache.get(fileId);
    if (dataUri) {
        // Move to end (most recently used) by re-inserting
        dataUriCache.delete(fileId);
        dataUriCache.set(fileId, dataUri);
    }
    return dataUri;
}

function clearCache(): void {
    dataUriCache.clear();
    currentCacheSize = 0;
}

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

    if (!override?.enabled) return null;

    if (override.selectedSound === "custom" && override.selectedFileId) {
        // null => cache miss - shouldn't happen if preloading worked, but don't block
        return getFromCache(override.selectedFileId) ?? null;
    }

    if (override.selectedSound !== "default" && override.selectedSound !== "custom") {
        if (override.selectedSound in SEASONAL_SOUNDS) return SEASONAL_SOUNDS[override.selectedSound];

        const soundType = allSoundTypes.find(t => t.id === id);
        if (!soundType?.seasonal) return null;

        const seasonalId = soundType.seasonal.find(id => id.startsWith(`${override.selectedSound}_`));
        if (seasonalId && seasonalId in SEASONAL_SOUNDS)
            return SEASONAL_SOUNDS[seasonalId];
    }

    return null;
}

export async function ensureDataURICached(fileId: string): Promise<string | null> {
    const cached = getFromCache(fileId);
    if (cached) return cached;

    try {
        const dataUri = await AudioStore.getAudioDataURI(fileId);
        if (dataUri) {
            addToCache(fileId, dataUri);
            return dataUri;
        }
    } catch (error) {
        console.error(`[CustomSounds] Error loading audio for ${fileId}:`, error);
    }

    return null;
}

export async function refreshDataURI(id: string): Promise<void> {
    const override = getOverride(id);
    if (!override?.selectedFileId) return;

    await ensureDataURICached(override.selectedFileId);
}

function resetSeasonalOverridesToDefault(): void {
    let count = 0;
    for (const soundType of allSoundTypes) {
        const override = getOverride(soundType.id);
        if (override.enabled && override.selectedSound in SEASONAL_SOUNDS) {
            override.selectedSound = "default";
            setOverride(soundType.id, override);
            count++;
        }
    }
    if (count > 0) console.log(`[CustomSounds] Reset ${count} seasonal sound(s) to default`);
}

async function preloadDataURIs(): Promise<void> {
    // Collect unique file IDs that need preloading
    const fileIdsToPreload = new Set<string>();

    for (const soundType of allSoundTypes) {
        const override = getOverride(soundType.id);
        if (override?.enabled && override.selectedSound === "custom" && override.selectedFileId) {
            fileIdsToPreload.add(override.selectedFileId);
        }
    }

    if (fileIdsToPreload.size === 0) return;

    // Preload each unique file (avoids duplicate loads if same file used for multiple sounds)
    let loaded = 0;
    for (const fileId of fileIdsToPreload) {
        try {
            await ensureDataURICached(fileId);
            loaded++;
        } catch (error) {
            console.error(`[CustomSounds] Failed to preload file ${fileId}:`, error);
        }
    }

    console.log(`[CustomSounds] Preloaded ${loaded}/${fileIdsToPreload.size} custom sounds`);
}

export async function debugCustomSounds(): Promise<void> {
    console.log("[CustomSounds] === DEBUG INFO ===");

    // Settings info
    console.log(`[CustomSounds] Max file size: ${AudioStore.getMaxFileSizeMB()}MB`);
    console.log(`[CustomSounds] Max cache size: ${Math.round(maxCacheSizeBytes / (1024 * 1024))}MB`);

    // Storage info
    const storageInfo = await AudioStore.getStorageInfo();
    console.log(`[CustomSounds] Stored files: ${storageInfo.fileCount}, Total size: ${storageInfo.totalSizeKB}KB`);

    // Memory cache info
    console.log(`[CustomSounds] Memory cache: ${dataUriCache.size} items, ${Math.round(currentCacheSize / 1024)}KB`);

    // Count enabled overrides
    let enabledCount = 0;
    let customSoundCount = 0;

    for (const soundType of allSoundTypes) {
        const override = getOverride(soundType.id);
        if (override.enabled) {
            enabledCount++;
            if (override.selectedSound === "custom") {
                customSoundCount++;
            }
        }
    }

    console.log(`[CustomSounds] Enabled overrides: ${enabledCount} (${customSoundCount} custom)`);

    // List all files
    const metadata = await AudioStore.getAllAudioMetadata();
    console.log("[CustomSounds] Audio files:");
    for (const [id, file] of Object.entries(metadata)) {
        console.log(`  - ${file.name} (${Math.round(file.size / 1024)}KB) [${id}]`);
    }

    console.log("[CustomSounds] === END DEBUG ===");

    showToast("Debug info printed in the console.");
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

// File size options (in MB)
const fileSizeOptions = [
    { value: 5, label: "5 MB (Conservative)" },
    { value: 15, label: "15 MB (Default)" },
    { value: 30, label: "30 MB (Large)" },
    { value: 50, label: "50 MB (Very Large)" },
    { value: 100, label: "100 MB (Extreme - Use with caution!)" },
];

const settings = definePluginSettings({
    ...soundSettings,
    maxFileSize: {
        type: OptionType.SELECT,
        description: "Maximum file size for custom audio uploads. Larger sizes use more memory, take more time to process and may cause performance issues or crashes on lower-end devices. Increase at your own risk!",
        options: fileSizeOptions,
        default: 15,
        onChange: (value: number) => {
            AudioStore.setMaxFileSizeMB(value);
            updateCacheLimit(value);
        }
    },
    resetSeasonalOnStartup: {
        type: OptionType.BOOLEAN,
        description: "Reset seasonal sounds to default on startup. Any sound set to a Halloween/Winter variant will be changed back to Default when the plugin loads.",
        default: true
    },
    overrides: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => {
            const [resetTrigger, setResetTrigger] = React.useState(0);
            const [searchQuery, setSearchQuery] = React.useState("");
            const [files, setFiles] = React.useState<Record<string, AudioStore.AudioFileMetadata>>({});
            const [filesLoaded, setFilesLoaded] = React.useState(false);
            const update = useForceUpdater();
            const audioFilesInputRef = React.useRef<HTMLInputElement>(null);
            const settingsFileInputRef = React.useRef<HTMLInputElement>(null);

            const loadFiles = React.useCallback(async () => {
                try {
                    const metadata = await AudioStore.getAllAudioMetadata();
                    setFiles(metadata);
                    setFilesLoaded(true);
                } catch (error) {
                    console.error("[CustomSounds] Error loading audio metadata:", error);
                    setFilesLoaded(true);
                }
            }, []);

            React.useEffect(() => {
                allSoundTypes.forEach(type => {
                    if (!settings.store[type.id]) {
                        setOverride(type.id, makeEmptyOverride());
                    }
                });
                loadFiles();
            }, []);

            const resetOverrides = () => {
                allSoundTypes.forEach(type => setOverride(type.id, makeEmptyOverride()));
                setResetTrigger((prev: number) => prev + 1);
                showToast("All overrides reset successfully!");
            };

            const handleSettingsUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];

                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (e: ProgressEvent<FileReader>) => {
                    try {
                        resetOverrides();
                        const imported = JSON.parse(e.target?.result as string);

                        if (imported.overrides && Array.isArray(imported.overrides)) {
                            const empty = makeEmptyOverride();
                            imported.overrides.forEach((setting: any) => {
                                if (!setting.id) return;

                                const override: SoundOverride = {
                                    enabled: setting.enabled ?? empty.enabled,
                                    selectedSound: setting.selectedSound ?? empty.selectedSound,
                                    selectedFileId: setting.selectedFileId ?? empty.selectedFileId,
                                    volume: setting.volume ?? empty.volume,
                                };
                                setOverride(setting.id, override);
                            });
                        }

                        setResetTrigger((prev: number) => prev + 1);
                        showToast("Settings imported successfully!");
                    } catch (error) {
                        console.error("Error importing settings:", error);
                        showToast("Error importing settings. Check console for details.");
                    }
                };

                reader.readAsText(file);
                event.target.value = "";
            };

            const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
                const { files } = event.target;
                if (!files) return;

                showToast(files.length > 1 ? `Uploading ${files.length} files...` : "Uploading file...");

                const filteredFiles: File[] = [];
                for (const file of files) {
                    if (!file) continue;

                    const fileExtension = file.name.split(".").pop()?.toLowerCase();
                    if (!fileExtension || !AUDIO_EXTENSIONS.includes(fileExtension)) {
                        showToast(`Invalid file type of "${file.name}". Please upload only audio files (${audioExtensionsString}).`);
                        continue;
                    }
                    filteredFiles.push(file);
                }

                // getting stores and loading the files into the plugin only once
                // reduces the upload time by a lot
                // tested with uploading 29 files (total size: 1.5 MB): 4-6s -> 300-900ms
                const results = await AudioStore.saveAudioFiles(filteredFiles);

                let successfulUploads = 0;
                let result: string | Error;
                for (result of results) {
                    if (typeof result !== "string") {
                        console.error("[CustomSounds] Upload error:", result);
                        const message = result.message ?? "Unknown error";
                        showToast(message.includes("too large") ? message : `Upload of "${result.name}" failed: ${message}`);
                        continue;
                    }

                    await ensureDataURICached(result);
                    successfulUploads += 1;
                }
                update();
                await loadFiles();

                showToast(`Added ${successfulUploads} files.`);
                event.target.value = "";
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

                const exportPayload = {
                    overrides,
                    __note: "Audio files are not included in exports and will need to be re-added before import"
                };

                const file = new File(
                    [JSON.stringify(exportPayload, null, 2)],
                    "customSounds-settings.json",
                    { type: "application/json" }
                );
                saveFile(file);

                showToast(`Exported ${overrides.length} settings. (Audio files are not included!)`);
            };

            const filteredSoundTypes = allSoundTypes.filter(type =>
                type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                type.id.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return (
                <div>
                    <Heading>Sounds</Heading>
                    <div className={cl("buttons")}>
                        <Button variant="positive" onClick={() => audioFilesInputRef.current?.click()}>Add</Button>
                        <Button
                            disabled={Object.keys(files).length === 0}
                            variant="dangerPrimary"
                            onClick={() => {
                                Alerts.show({
                                    title: "Are you sure?",
                                    body: `This will remove ${Object.keys(files).length} file${Object.keys(files).length === 1 ? "" : "s"} imported into the plugin.`,
                                    async onConfirm() {
                                        await AudioStore.clearStore();
                                        clearCache();
                                        update();
                                        await loadFiles();
                                        allSoundTypes.forEach(type => {
                                            const override = getOverride(type.id);
                                            override.selectedFileId = undefined;
                                            setOverride(type.id, override);
                                        });
                                        showToast("Files removed successfully.");
                                    },
                                    confirmText: "Do it!",
                                    confirmColor: "vc-notification-log-danger-btn",
                                    cancelText: "Nevermind"
                                });
                            }}
                        >
                            Remove All</Button>
                        <Button variant="overlayPrimary" onClick={debugCustomSounds}>Debug</Button>
                        <input
                            ref={audioFilesInputRef}
                            type="file"
                            accept=".mp3,.wav,.ogg,.m4a,.flac,.aac,.webm,.wma,.mp4"
                            multiple
                            style={{ display: "none" }}
                            onChange={uploadFiles}
                        />
                    </div>
                    <Heading>Overrides</Heading>
                    <div className={cl("buttons")}>
                        <Button variant="primary" onClick={() => settingsFileInputRef.current?.click()}>Import</Button>
                        <Button variant="secondary" onClick={downloadSettings}>Export</Button>
                        <Button variant="dangerPrimary" onClick={resetOverrides}>Reset All</Button>
                        <input
                            ref={settingsFileInputRef}
                            type="file"
                            accept=".json"
                            style={{ display: "none" }}
                            onChange={handleSettingsUpload}
                        />
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

                                return (
                                    <SoundOverrideComponent
                                        key={`${type.id}-${resetTrigger}`}
                                        type={type}
                                        override={currentOverride}
                                        files={files}
                                        onFilesChange={loadFiles}
                                        onChange={async () => {
                                            setOverride(type.id, currentOverride);

                                            if (currentOverride.enabled && currentOverride.selectedSound === "custom" && currentOverride.selectedFileId) {
                                                try {
                                                    await ensureDataURICached(currentOverride.selectedFileId);
                                                } catch (error) {
                                                    console.error("[CustomSounds] Failed to load custom sound:", error);
                                                    showToast("Error loading custom sound file. Check console for details.");
                                                }
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
    }
});

export function isOverriden(id: string): boolean {
    return !!getOverride(id)?.enabled;
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
    ],
    findOverride,
    isOverriden,
    getCustomSoundURL,
    refreshDataURI,
    ensureDataURICached,
    debugCustomSounds,
    startAt: StartAt.Init,

    async start() {
        try {
            // Initialize max file size and cache limit from settings
            const maxSize = settings.store.maxFileSize ?? 15;
            AudioStore.setMaxFileSizeMB(maxSize);
            updateCacheLimit(maxSize);

            // Optionally reset seasonal sounds to default on startup
            if (settings.store.resetSeasonalOnStartup) {
                resetSeasonalOverridesToDefault();
            }

            // Migrate old storage format if needed (removes redundant buffers)
            await AudioStore.migrateStorage();

            // Preload enabled custom sounds into memory
            await preloadDataURIs();
        } catch (error) {
            console.error("[CustomSounds] Startup error:", error);
        }
    }
});
