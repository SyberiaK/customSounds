/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { get, set } from "@api/DataStore";

const STORAGE_KEY = "CustomSounds";
const METADATA_KEY = "CustomSounds_Metadata";

const BASE64_OVERHEAD = 1.37;
const DEFAULT_MAX_FILE_SIZE_MB = 15;
let maxFileSizeMB = DEFAULT_MAX_FILE_SIZE_MB;

export function setMaxFileSizeMB(sizeMB: number): void {
    maxFileSizeMB = sizeMB;
}

export function getMaxFileSizeMB(): number {
    return maxFileSizeMB;
}

export interface StoredAudioFile {
    id: string;
    name: string;
    type: string;
    dataUri: string;
}

export interface AudioFileMetadata {
    id: string;
    name: string;
    type: string;
    size: number;
}

type MetadataStore = Record<string, AudioFileMetadata>;
type AudioStore = Record<string, StoredAudioFile>;

export async function getAllAudioMetadata(): Promise<MetadataStore> {
    return (await get(METADATA_KEY)) as MetadataStore ?? {};
}

async function setMetadataStore(new_: MetadataStore): Promise<void> {
    await set(METADATA_KEY, new_);
}

export async function getAudioDataURI(id: string): Promise<string | undefined> {
    const all: AudioStore = await getAllAudio();
    return all?.[id]?.dataUri;
}

export async function getAllAudio(): Promise<AudioStore> {
    return (await get(STORAGE_KEY)) as AudioStore ?? {};
}

async function setAudioStore(new_: AudioStore): Promise<void> {
    await set(STORAGE_KEY, new_);
}

export async function saveAudioData(audioData: [StoredAudioFile, AudioFileMetadata][]): Promise<void> {
    const audioStore: AudioStore = await getAllAudio();
    const metadataStore: MetadataStore = await getAllAudioMetadata();

    for (const [data, metadata] of audioData) { // processing files asyncronounsly makes no real difference
        audioStore[metadata.id] = data;
        metadataStore[metadata.id] = metadata;
    }

    await setAudioStore(audioStore);
    await setMetadataStore(metadataStore);
}

export async function processAudioFile(file: File): Promise<[StoredAudioFile, AudioFileMetadata]> {
    const maxBytes = maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
        const fileMB = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`File "${file.name}" is too large (${fileMB}MB). Maximum size is ${maxFileSizeMB}MB.`);
    }

    const buffer = await file.arrayBuffer();
    const dataUri = await generateDataURI(buffer, file.type, file.name);

    return await importAudioData({
        id: file.name,
        name: file.name,
        type: file.type,
        dataUri
    });
}

export async function importAudioData(data: StoredAudioFile): Promise<[StoredAudioFile, AudioFileMetadata]> {
    const { name, type, dataUri } = data;

    const maxBytes = maxFileSizeMB * 1024 * 1024;
    if (dataUri.length / BASE64_OVERHEAD > maxBytes) {
        const fileMB = (dataUri.length / (1024 * 1024) / BASE64_OVERHEAD).toFixed(1);
        throw new Error(`File "${name}" is too large (${fileMB}MB). Maximum size is ${maxFileSizeMB}MB.`);
    }

    const id = data.id || name;

    return [
        {
            id,
            name,
            type,
            dataUri
        },
        {
            id,
            name,
            type,
            size: dataUri.length
        }
    ];
}

export async function deleteAudio(id: string): Promise<void> {
    // Delete from audio store
    const audioStore: AudioStore = await getAllAudio();
    if (audioStore[id]) {
        delete audioStore[id];
        await setAudioStore(audioStore);
    }

    // Delete from metadata store
    const metadataStore: MetadataStore = await getAllAudioMetadata();
    if (metadataStore[id]) {
        delete metadataStore[id];
        await setMetadataStore(metadataStore);
    }
}

export async function clearStore(): Promise<void> {
    await setAudioStore({});
    await setMetadataStore({});
}

async function generateDataURI(buffer: ArrayBuffer, type: string, name: string): Promise<string> {
    let mimeType = type || "audio/mpeg";

    if (!mimeType || mimeType === "application/octet-stream") {
        if (name) {
            const extension = name.split(".").pop()?.toLowerCase();
            switch (extension) {
                case "ogg": mimeType = "audio/ogg"; break;
                case "mp3": mimeType = "audio/mpeg"; break;
                case "wav": mimeType = "audio/wav"; break;
                case "m4a":
                case "mp4": mimeType = "audio/mp4"; break;
                case "flac": mimeType = "audio/flac"; break;
                case "aac": mimeType = "audio/aac"; break;
                case "webm": mimeType = "audio/webm"; break;
                case "wma": mimeType = "audio/x-ms-wma"; break;
                default: mimeType = "audio/mpeg";
            }
        }
    }

    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: mimeType });

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
