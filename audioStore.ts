/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { get, set } from "@api/DataStore";

const STORAGE_KEY = "ScattrdCustomSounds";
const METADATA_KEY = "ScattrdCustomSounds_Metadata";

// Default maximum file size: 15MB per file
const DEFAULT_MAX_FILE_SIZE_MB = 15;

// Configurable max file size (set by plugin settings)
let maxFileSizeMB = DEFAULT_MAX_FILE_SIZE_MB;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    size: number; // Size of dataUri in bytes
}

// Lightweight metadata stored separately for fast access
type MetadataStore = Record<string, AudioFileMetadata>;

// Full audio data (only dataUri, no redundant buffer)
type AudioStore = Record<string, StoredAudioFile>;

/**
 * Returns audio files metadata.
 */
export async function getAllAudioMetadata(): Promise<MetadataStore> {
    return (await get(METADATA_KEY)) as MetadataStore ?? {};
}

async function setMetadataStore(new_: MetadataStore): Promise<void> {
    await set(METADATA_KEY, new_);
}

/**
 * Returns a single audio file's data URI.
 */
export async function getAudioDataURI(id: string): Promise<string | undefined> {
    const all: AudioStore = await getAllAudio();
    return all?.[id]?.dataUri;
}

/**
 * Returns all audio files (use sparingly as it loads all the data)
 */
export async function getAllAudio(): Promise<AudioStore> {
    return (await get(STORAGE_KEY)) as AudioStore ?? {};
}

async function setAudioStore(new_: AudioStore): Promise<void> {
    await set(STORAGE_KEY, new_);
}

async function getBufferHashString(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer: ArrayBuffer = await crypto.subtle.digest("SHA-256", buffer);

    const hashView = new Uint8Array(hashBuffer);

    const hashString = Array.from(hashView)
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
    return hashString;
}

/**
 * Saves an audio file.
 *
 * If the file exceeds the size limit, throws an `Error`.
 */
export async function saveAudioFile(file: File): Promise<string> {
    const [id, audioData, metadata] = await processAudioFile(file);

    // Store the audio data (only dataUri, not buffer)
    const audioStore: AudioStore = await getAllAudio();
    audioStore[id] = audioData;
    await setAudioStore(audioStore);

    // Store metadata separately for fast access
    const metadataStore: MetadataStore = await getAllAudioMetadata();
    metadataStore[id] = metadata;
    await setMetadataStore(metadataStore);

    return id;
}


/**
 * Saves multiple audio files.
 *
 * Returns an array, where each upload is represented with either a file ID string (if success) or `Error`.
 */
export async function saveAudioFiles(files: File[]): Promise<(string | Error)[]> {
    const results: (string | Error)[] = [];
    const audioStore: AudioStore = await getAllAudio();
    const metadataStore: MetadataStore = await getAllAudioMetadata();

    for (const file of files) {
        try {
            const [id, audioData, metadata] = await processAudioFile(file);
            audioStore[id] = audioData;
            metadataStore[id] = metadata;
            results.push(id);
        } catch (error: any) {
            results.push(error as Error);
        }
    }

    await setAudioStore(audioStore);
    await setMetadataStore(metadataStore);

    return results;
}

async function processAudioFile(file: File): Promise<[string, StoredAudioFile, AudioFileMetadata]> {
    const maxBytes = maxFileSizeMB * 1024 * 1024;
    if (file.size > maxBytes) {
        const fileMB = (file.size / (1024 * 1024)).toFixed(1);
        throw new Error(`File too large (${fileMB}MB). Maximum size is ${maxFileSizeMB}MB.`);
    }

    const buffer = await file.arrayBuffer();
    const id = await getBufferHashString(buffer);
    const dataUri = await generateDataURI(buffer, file.type, file.name);

    return [
        id,
        {
            id,
            name: file.name,
            type: file.type,
            dataUri
        },
        {
            id,
            name: file.name,
            type: file.type,
            size: dataUri.length
        }
    ];
}

/**
 * Deletes an audio file.
 */
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

/**
 * Deletes all audio files.
 */
export async function clearStore(): Promise<void> {
    await setAudioStore({});
    await setMetadataStore({});
}

function isUUIDLike(s: string): boolean {
    return UUID_REGEX.test(s);
}

/**
 * Migrates old storage format to new format (run once on startup).
 */
export async function migrateStorage(): Promise<boolean> {
    const audioStore = (await get(STORAGE_KEY)) as Record<string, any> | undefined;
    if (!audioStore) return false;

    let needsMigration = false;
    let needsMetadataRebuild = false;

    // Check if any entries have the old 'buffer' field
    for (const file of Object.values(audioStore)) {
        if (!file) continue;
        if (typeof file !== "object") continue;

        if ("buffer" in file ||
            ("id" in file && isUUIDLike(file.id))) {
            needsMigration = true;
            break;
        }
    }

    // Check if metadata store exists
    const metadataStore = await get(METADATA_KEY);
    if (!metadataStore && Object.keys(audioStore).length > 0) {
        needsMetadataRebuild = true;
    }

    if (needsMigration) {
        console.log("[CustomSounds] Migrating storage to remove redundant buffers and fix IDs...");
        const newAudioStore: AudioStore = {};

        for (const [file] of Object.values(audioStore)) {
            if (!file || typeof file !== "object") continue;

            // If it has dataUri, keep it; if only buffer, generate dataUri
            let { dataUri } = file;
            if (!dataUri && file.buffer) {
                dataUri = await generateDataURI(file.buffer, file.type, file.name);
            }

            if (!dataUri) continue;

            // Migrate from random UUIDs to file hashes to make imports actually useful
            const new_id = await getBufferHashString(file.buffer);

            newAudioStore[new_id] = {
                id: new_id,
                name: file.name || "Unknown",
                type: file.type || "audio/mpeg",
                dataUri
            };
        }

        await setAudioStore(newAudioStore);
        needsMetadataRebuild = true;
        console.log("[CustomSounds] Storage migration complete");
    }

    if (needsMetadataRebuild) {
        console.log("[CustomSounds] Rebuilding metadata index...");
        const currentAudioStore = await getAllAudio();
        const newMetadataStore: MetadataStore = {};

        for (const [id, file] of Object.entries(currentAudioStore)) {
            newMetadataStore[id] = {
                id: file.id,
                name: file.name,
                type: file.type,
                size: file.dataUri?.length || 0
            };
        }

        await setMetadataStore(newMetadataStore);
        console.log("[CustomSounds] Metadata rebuild complete");
    }

    return needsMigration || needsMetadataRebuild;
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

/**
 * Returns total storage usage info in an object.
 */
export async function getStorageInfo(): Promise<{ fileCount: number; totalSizeKB: number; }> {
    const metadata = await getAllAudioMetadata();
    let totalSize = 0;

    for (const file of Object.values(metadata)) {
        totalSize += file.size || 0;
    }

    return {
        fileCount: Object.keys(metadata).length,
        totalSizeKB: Math.round(totalSize / 1024)
    };
}
