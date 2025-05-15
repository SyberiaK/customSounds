/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, Forms, React, showToast, TextInput } from "@webpack/common";

import { getAudioDataURI } from "./audioStore";
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

    try {
        const dataUri = await getAudioDataURI(override.selectedFileId);
        if (dataUri) {
            override.url = dataUri;
        }
    } catch (error) {
        console.error(`[CustomSounds] Error refreshing data URI for ${id}:`, error);
    }
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

                            if (imported.overrides && Array.isArray(imported.overrides)) {
                                imported.overrides.forEach((setting: any) => {
                                    if (setting.id in settings.store) {
                                        settings.store[setting.id] = {
                                            enabled: setting.enabled ?? false,
                                            selectedSound: setting.selectedSound ?? "default",
                                            selectedFileId: setting.selectedFileId ?? undefined,
                                            volume: setting.volume ?? 100,
                                            url: "",
                                            useFile: false,
                                            base64Data: undefined
                                        };
                                    }
                                });
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
                        selectedFileId: value.selectedFileId ?? undefined,
                        volume: value.volume
                    }));

                const exportPayload = {
                    overrides,
                    __note: "Audio files are not included in exports and will need to be re-uploaded after import"
                };

                const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "customSounds-settings.json";
                a.click();
                URL.revokeObjectURL(url);

                showToast(`Exported ${overrides.length} settings (audio files not included)`);
            };

            const filteredSoundTypes = allSoundTypes.filter(type =>
                type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                type.id.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return (
                <div>
                    <div className="vc-custom-sounds-buttons">
                        <Button color={Button.Colors.BRAND} onClick={triggerFileUpload}>Import</Button>
                        <Button color={Button.Colors.WHITE} onClick={downloadSettings}>Export</Button>
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
                                onChange={async () => {
                                }}
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

    async start() {
        console.log("[CustomSounds] Plugin starting...");

        try {
            console.log("[CustomSounds] Preloading data URIs...");
            await preloadDataURIs();

            console.log("[CustomSounds] Startup complete");
        } catch (error) {
            console.error("[CustomSounds] Startup failed:", error);
        }
    }
});
