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

/*
 * `type` is the mimetype of file and is practically useless
 * unless it differs from the derived one for dataUri
 *  (even if so, why would we care even)
 */
export interface AudioData {
    id: string;
    name: string;
    type: string | undefined;
    dataUri: string;
}

export interface AudioMetadata {
    id: string;
    name: string;
    type: string | undefined;
    size: number;
    checksum: string | undefined;
}

type MetadataStore = Record<string, AudioMetadata>;
type AudioStore = Record<string, AudioData>;

export async function getAllAudioMetadata(): Promise<MetadataStore> {
    return (await get(METADATA_KEY)) as MetadataStore ?? {};
}

async function setMetadataStore(new_: MetadataStore): Promise<void> {
    await set(METADATA_KEY, new_);
}

export async function getAudioDataURI(id: string): Promise<string | undefined> {
    const all = await getAllAudio();
    return all?.[id]?.dataUri;
}

export async function getAllAudio(): Promise<AudioStore> {
    return (await get(STORAGE_KEY)) as AudioStore ?? {};
}

async function setAudioStore(new_: AudioStore): Promise<void> {
    await set(STORAGE_KEY, new_);
}

export async function saveAudioData(audioData: [AudioData, AudioMetadata][]): Promise<void> {
    const audioStore = await getAllAudio();
    const metadataStore = await getAllAudioMetadata();

    for (const [data, metadata] of audioData) {
        audioStore[metadata.id] = data;
        metadataStore[metadata.id] = metadata;
    }

    await setAudioStore(audioStore);
    await setMetadataStore(metadataStore);
}

async function getStringHash(input: string) {
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));

    return Array.from(new Uint8Array(hashBuffer))
        .map(item => item.toString(16).padStart(2, "0"))
        .join("");
}

export async function processAudioFile(file: File): Promise<[AudioData, AudioMetadata]> {
    const maxBytes = maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
        const fileMB = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`"${file.name}" is too large (${fileMB}MB). Maximum size is ${maxFileSizeMB}MB.`);
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

export async function importAudioData(data: AudioData): Promise<[AudioData, AudioMetadata]> {
    const { name, type, dataUri } = data;

    const maxBytes = maxFileSizeMB * 1024 * 1024;
    if (dataUri.length / BASE64_OVERHEAD > maxBytes) {
        const fileMB = (dataUri.length / (1024 * 1024) / BASE64_OVERHEAD).toFixed(1);
        throw new Error(`File "${name}" is too large (${fileMB}MB). Maximum size is ${maxFileSizeMB}MB.`);
    }

    const id = data.id || name;
    const checksum = await getStringHash(dataUri);

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
            size: dataUri.length,
            checksum
        }
    ];
}

export async function deleteAudio(id: string): Promise<void> {
    const audioStore = await getAllAudio();
    if (audioStore[id]) {
        delete audioStore[id];
        await setAudioStore(audioStore);
    }

    const metadataStore = await getAllAudioMetadata();
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
    let mimeType = type || "";

    if (mimeType.startsWith("video/")) mimeType = mimeType.replace("video/", "audio/");

    if ((!mimeType || mimeType === "application/octet-stream") && name.includes(".")) {
        const extension = name.split(".").pop()!.toLowerCase();
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
        }
    }

    if (!mimeType) mimeType = "audio/mpeg";

    const blob = new Blob([buffer], { type: mimeType });

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}
