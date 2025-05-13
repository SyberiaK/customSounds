/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { get as getFromDataStore, set as setToDataStore } from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, React, showToast, TextInput } from "@webpack/common";

import { getAudioDataURI, saveAudio } from "./audioStore";
import { SoundOverrideComponent } from "./SoundOverrideComponent";
import { makeEmptyOverride, seasonalSounds, SoundOverride, soundTypes } from "./types";

const cl = classNameFactory("vc-custom-sounds-");

const allSoundTypes = soundTypes || [];

const AUDIO_STORE_KEY = "ScattrdCustomSounds";

export function getCustomSoundURL(id: string): string | null {
    const override = settings.store[id];

    if (!override?.enabled) {
        return null;
    }

    if (override.selectedSound === "custom" && override.url && override.url.startsWith("data:audio/")) {
        return override.url;
    }

    if (override.selectedSound !== "default" && override.selectedSound !== "custom") {
        if (override.selectedSound in seasonalSounds) {
            return seasonalSounds[override.selectedSound];
        }

        const soundType = allSoundTypes.find(t => t.id === id);
        if (soundType?.seasonal) {
            const seasonalId = soundType.seasonal.find(seasonalId =>
                seasonalId.startsWith(`${override.selectedSound}_`)
            );
            if (seasonalId && seasonalId in seasonalSounds) {
                return seasonalSounds[seasonalId];
            }
        }
    }

    return null;
}

export async function refreshDataURI(id: string): Promise<void> {
    const override = settings.store[id];
    if (!override?.selectedFileId) {
        return;
    }

    const dataUri = await getAudioDataURI(override.selectedFileId);
    if (dataUri) {
        override.url = dataUri;
    } else {
        console.error(`[CustomSounds] Failed to get data URI for ${id}`);
    }
}

export async function cleanupOldBase64Data(): Promise<number> {
    let hasBase64Data = false;
    for (const [soundId, override] of Object.entries(settings.store)) {
        if (soundId === "overrides") continue;
        if (override.base64Data) {
            hasBase64Data = true;
            break;
        }
    }

    if (!hasBase64Data) {
        return 0;
    }

    let cleanedCount = 0;

    for (const [soundId, override] of Object.entries(settings.store)) {
        if (soundId === "overrides") continue;

        if (override.base64Data) {
            try {
                const base64Part = override.base64Data.startsWith("data:")
                    ? override.base64Data.split(",")[1]
                    : override.base64Data;

                let fileType = "audio/mpeg";
                if (override.base64Data.startsWith("data:")) {
                    const typeMatch = override.base64Data.match(/data:([^;]+)/);
                    if (typeMatch) {
                        fileType = typeMatch[1];
                    }
                }

                const binary = atob(base64Part);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: fileType });

                const fileName = `migrated_${soundId}`;
                const file = new File([blob], fileName, { type: fileType });
                const fileId = await saveAudio(file);

                override.selectedFileId = fileId;
                override.selectedSound = "custom";

                await refreshDataURI(soundId);

                delete override.base64Data;

                cleanedCount++;
            } catch (error) {
                console.error(`[CustomSounds] Failed to migrate base64 for ${soundId}:`, error);
                delete override.base64Data;
            }
        }
    }

    if (cleanedCount > 0) {
        try {
            settings.store = { ...settings.store };
        } catch (error) {
            console.error("[CustomSounds] Failed to save cleaned settings:", error);
        }
    }

    return cleanedCount;
}

export async function cleanupOldDataURIs(): Promise<number> {
    let cleanedCount = 0;

    for (const [soundId, override] of Object.entries(settings.store)) {
        if (soundId === "overrides") continue;

        if (override.url && override.url.startsWith("data:audio/") &&
            (!override.selectedFileId || override.selectedSound !== "custom")) {

            try {
                const base64Part = override.url.split(",")[1];
                const typeMatch = override.url.match(/data:([^;]+)/);
                const fileType = typeMatch ? typeMatch[1] : "audio/mpeg";

                const binary = atob(base64Part);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: fileType });

                const fileName = `recovered_${soundId}`;
                const file = new File([blob], fileName, { type: fileType });
                const fileId = await saveAudio(file);

                override.selectedFileId = fileId;
                override.selectedSound = "custom";

                await refreshDataURI(soundId);

                cleanedCount++;
            } catch (error) {
                console.error(`[CustomSounds] Failed to recover data URI for ${soundId}:`, error);
                override.url = "";
            }
        }
    }

    if (cleanedCount > 0) {
        settings.store = { ...settings.store };
    }

    return cleanedCount;
}

async function preloadDataURIs() {
    for (const soundType of allSoundTypes) {
        const override = settings.store[soundType.id];
        if (override?.enabled && override.selectedSound === "custom" && override.selectedFileId) {
            try {
                await refreshDataURI(soundType.id);
            } catch (error) {
                console.error(`[CustomSounds] Failed to preload data URI for ${soundType.id}:`, error);
            }
        }
    }
}

const settings = definePluginSettings({
    overrides: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => {
            const [resetTrigger, setResetTrigger] = React.useState(0);
            const [searchQuery, setSearchQuery] = React.useState("");
            const fileInputRef = React.useRef<HTMLInputElement>(null);

            const resetOverrides = () => {
                allSoundTypes.forEach(type => {
                    settings.store[type.id] = makeEmptyOverride();
                });
                setResetTrigger(prev => prev + 1);
            };

            const triggerFileUpload = () => {
                fileInputRef.current?.click();
            };

            const handleSettingsUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (e: ProgressEvent<FileReader>) => {
                        try {
                            resetOverrides();
                            const imported = JSON.parse(e.target?.result as string);

                            if (imported.__files && typeof imported.__files === "object") {
                                const store = await getFromDataStore(AUDIO_STORE_KEY) ?? {};

                                for (const [fileId, fileData] of Object.entries(imported.__files)) {
                                    if (!fileData) continue;

                                    try {
                                        let base64: string;
                                        let fileName: string;

                                        if (typeof fileData === "string") {
                                            base64 = fileData;
                                            fileName = `imported_${fileId}`;
                                        } else if (typeof fileData === "object" && "data" in fileData && "name" in fileData) {
                                            base64 = fileData.data as string;
                                            fileName = fileData.name as string;
                                        } else {
                                            console.error(`[CustomSounds] Invalid file data format for ${fileId}`);
                                            continue;
                                        }

                                        store[fileId] = {
                                            id: fileId,
                                            name: fileName,
                                            base64,
                                            type: "audio/mpeg"
                                        };
                                    } catch (error) {
                                        console.error(`[CustomSounds] Failed to import file ${fileId}:`, error);
                                    }
                                }

                                await setToDataStore(AUDIO_STORE_KEY, store);
                            }

                            if (imported.overrides && Array.isArray(imported.overrides)) {
                                imported.overrides.forEach((setting: any) => {
                                    if (setting.id in settings.store) {
                                        settings.store[setting.id] = {
                                            enabled: setting.enabled ?? false,
                                            selectedSound: setting.selectedSound ?? "default",
                                            selectedFileId: setting.selectedFileId ?? null,
                                            volume: setting.volume ?? 100,
                                            url: "",
                                            useFile: false,
                                            base64Data: undefined
                                        };
                                    }
                                });
                            }

                            for (const soundType of allSoundTypes) {
                                const override = settings.store[soundType.id];
                                if (override?.selectedFileId && override.selectedSound === "custom") {
                                    await refreshDataURI(soundType.id);
                                }
                            }

                            setResetTrigger(prev => prev + 1);
                            showToast("Settings imported successfully!");
                        } catch (error) {
                            console.error("Error importing settings:", error);
                            showToast("Error importing settings. Check console for details.");
                        }
                    };

                    reader.readAsText(file);
                    event.target.value = "";
                }
            };

            const downloadSettings = async () => {
                const overrides = Object.entries(settings.store)
                    .filter(([key]) => key !== "overrides")
                    .map(([key, value]) => ({
                        id: key,
                        enabled: value.enabled,
                        selectedSound: value.selectedSound,
                        selectedFileId: value.selectedFileId ?? null,
                        volume: value.volume
                    }));

                const usedFileIds = new Set(overrides.map(o => o.selectedFileId).filter(Boolean));
                const fileBlobs: Record<string, { data: string; name: string; }> = {};
                const store = await getFromDataStore(AUDIO_STORE_KEY) ?? {};

                for (const fileId of usedFileIds) {
                    const entry = store[fileId as string];

                    if (!entry || !entry.base64) {
                        console.warn(`[CustomSounds] No base64 data for file ${fileId}`);
                        continue;
                    }

                    fileBlobs[fileId as string] = {
                        data: entry.base64,
                        name: entry.name || `unknown_${fileId}`
                    };
                }

                const exportPayload = {
                    overrides,
                    __files: fileBlobs
                };

                const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "customSounds-settings.json";
                a.click();
                URL.revokeObjectURL(url);

                showToast(`Exported ${overrides.length} settings and ${Object.keys(fileBlobs).length} files`);
            };

            const filteredSoundTypes = allSoundTypes.filter(type =>
                type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                type.id.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return (
                <div>
                    <div className="vc-custom-sounds-buttons">
                        <Button color={Button.Colors.BRAND} onClick={triggerFileUpload}>Import</Button>
                        <Button color={Button.Colors.PRIMARY} onClick={downloadSettings}>Export</Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            style={{ display: "none" }}
                            onChange={handleSettingsUpload}
                        />
                    </div>

                    <div className={cl("search")}>
                        <Forms.FormTitle>Search Sounds</Forms.FormTitle>
                        <TextInput
                            value={searchQuery}
                            onChange={e => setSearchQuery(e)}
                            placeholder="Search by name or ID"
                        />
                    </div>

                    <div className={cl("sounds-list")}>
                        {filteredSoundTypes.map(type => (
                            <SoundOverrideComponent
                                key={`${type.id}-${resetTrigger}`}
                                type={type}
                                override={settings.store[type.id] ?? makeEmptyOverride()}
                                onChange={() => Promise.resolve()}
                            />
                        ))}
                    </div>
                </div>
            );
        }
    }
});

export function isOverriden(id: string): boolean {
    return !!settings.store[id]?.enabled;
}

export function findOverride(id: string): SoundOverride | null {
    const override = settings.store[id];
    const result = override?.enabled ? override : null;
    return result;
}

export default definePlugin({
    name: "CustomSounds",
    description: "Customize Discord's sounds.",
    authors: [Devs.ScattrdBlade, Devs.TheKodeToad],
    patches: [
        {
            find: 'Error("could not play audio")',
            replacement: [
                {
                    match: /(?<=new Audio;\i\.src=)\i\([0-9]+\)\("\.\/"\.concat\(this\.name,"\.mp3"\)\)/,
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
        }
    ],
    settings,
    findOverride,
    isOverriden,
    getCustomSoundURL,
    refreshDataURI,
    cleanupOldBase64Data,
    cleanupOldDataURIs,

    async start() {
        try {
            await cleanupOldBase64Data();
            await cleanupOldDataURIs();
            await preloadDataURIs();
        } catch (error) {
            console.error("[CustomSounds] Startup failed:", error);
        }
    }
});
