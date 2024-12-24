/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface SoundType {
    name: string;
    id: string;
    seasonal?: string[];
}

export interface SoundOverride {
    enabled: boolean;
    url: string;
    useFile: boolean;
    volume: number;
    selectedSound: string;
}

export interface SoundPlayer {
    loop(): void;
    play(): void;
    pause(): void;
    stop(): void;
}

export const soundTypes: readonly SoundType[] = [
    { name: "Message", id: "message1", seasonal: ["halloween_message1"] },
    { name: "Message (Focused Channel)", id: "message3" },
    { name: "Defean", id: "deafen", seasonal: ["halloween_deafen", "halloween_defean", "winter_deafen"] },
    { name: "Undefean", id: "undeafen", seasonal: ["halloween_undeafen", "halloween_undefean", "winter_undeafen"] },
    { name: "Mute", id: "mute", seasonal: ["halloween_mute", "winter_mute"] },
    { name: "Unmute", id: "unmute", seasonal: ["halloween_unmute", "winter_unmute"] },
    { name: "Voice Disconnected", id: "disconnect", seasonal: ["halloween_disconnect", "winter_disconnect"] },
    { name: "PTT Activate", id: "ptt_start" },
    { name: "PTT Deactive", id: "ptt_stop" },
    { name: "User Join", id: "user_join", seasonal: ["halloween_user_join", "winter_user_join"] },
    { name: "User Leave", id: "user_leave", seasonal: ["halloween_user_leave", "winter_user_leave"] },
    { name: "User Moved", id: "user_moved" },
    { name: "Outgoing Ring", id: "call_calling", seasonal: ["halloween_call_calling", "winter_call_calling"] },
    { name: "Incoming Ring", id: "call_ringing", seasonal: ["halloween_call_ringing", "winter_call_ringing"] },
    { name: "Stream Started", id: "stream_started" },
    { name: "Stream Ended", id: "stream_ended" },
    { name: "Viewer Join", id: "stream_user_joined" },
    { name: "Viewer Leave", id: "stream_user_left" },
    { name: "Activity Start", id: "activity_launch" },
    { name: "Activity End", id: "activity_end" },
    { name: "Activity User Join", id: "activity_user_join" },
    { name: "Activity User Leave", id: "activity_user_left" },
    { name: "Invited to Speak", id: "reconnect" }
] as const;

export function makeEmptyOverride(): SoundOverride {
    return {
        enabled: false,
        useFile: false,
        url: "",
        volume: 100,
        selectedSound: "original"
    };
}
