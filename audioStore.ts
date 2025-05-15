/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { get, set } from "@api/DataStore";

const STORAGE_KEY = "ScattrdCustomSounds";

export interface StoredAudioFile {
    id: string;
    name: string;
    buffer: ArrayBuffer;
    type: string;
}

export async function saveAudio(file: File): Promise<string> {
    const id = crypto.randomUUID();
    const buffer = await file.arrayBuffer();

    const current = (await get(STORAGE_KEY)) ?? {};
    current[id] = {
        id,
        name: file.name,
        buffer,
        type: file.type
    };
    await set(STORAGE_KEY, current);
    return id;
}

export async function getAllAudio(): Promise<Record<string, StoredAudioFile>> {
    return (await get(STORAGE_KEY)) ?? {};
}

export async function getAudioDataURI(id: string): Promise<string | undefined> {
    const all = await getAllAudio();
    const entry = all[id];
    if (!entry) return undefined;

    try {
        const uint8Array = new Uint8Array(entry.buffer);

        const blob = new Blob([uint8Array], { type: entry.type });

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("[CustomSounds] Error converting buffer to data URI:", error);

        const uint8Array = new Uint8Array(entry.buffer);
        let binary = "";
        const chunkSize = 8192;

        for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            binary += String.fromCharCode(...chunk);
        }

        const base64 = btoa(binary);
        return `data:${entry.type};base64,${base64}`;
    }
}

export async function deleteAudio(id: string): Promise<void> {
    const all = await getAllAudio();
    delete all[id];
    await set(STORAGE_KEY, all);
}
