/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { get, set } from "@api/DataStore";

const STORAGE_KEY = "ScattrdCustomSounds";

export async function saveAudio(file: File): Promise<string> {
    const id = crypto.randomUUID();

    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const current = (await get(STORAGE_KEY)) ?? {};
    current[id] = {
        id,
        name: file.name,
        base64,
        type: file.type
    };
    await set(STORAGE_KEY, current);
    return id;
}

export async function getAllAudio(): Promise<Record<string, { id: string; name: string; base64: string; type: string; }>> {
    return (await get(STORAGE_KEY)) ?? {};
}

export async function getAudioDataURI(id: string): Promise<string | undefined> {
    const all = await getAllAudio();
    const entry = all[id];
    return entry ? `data:${entry.type};base64,${entry.base64}` : undefined;
}

export async function deleteAudio(id: string): Promise<void> {
    const all = await getAllAudio();
    delete all[id];
    await set(STORAGE_KEY, all);
}
