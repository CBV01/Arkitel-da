"use client";

import React, { useState, useEffect } from 'react';
import { Megaphone, X, Info, AlertTriangle, CheckCircle } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

interface Broadcast {
    id: number;
    message: string;
    type: 'info' | 'warning' | 'success';
}

export function BroadcastBanner() {
    const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

    useEffect(() => {
        const fetchBroadcasts = async () => {
            try {
                const res = await apiFetch('/api/broadcasts');
                if (res.ok) {
                    const data = await res.json();
                    setBroadcasts(data.broadcasts || []);
                }
            } catch (e) {
                console.error("Failed to fetch broadcasts:", e);
            }
        };

        fetchBroadcasts();
        // Refresh every 5 minutes
        const interval = setInterval(fetchBroadcasts, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    if (broadcasts.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 mb-6">
            {broadcasts.map((b) => (
                <div 
                    key={b.id} 
                    className={`flex items-center gap-3 px-6 py-3 rounded-2xl border animate-in slide-in-from-top duration-500 overflow-hidden relative group ${
                        b.type === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                        b.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                        'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                    }`}
                >
                    <div className="shrink-0">
                        {b.type === 'warning' ? <AlertTriangle size={18} /> : 
                         b.type === 'success' ? <CheckCircle size={18} /> : 
                         <Megaphone size={18} />}
                    </div>
                    <div className="flex-1 font-bold text-sm tracking-tight">
                        <span className="opacity-60 mr-2 uppercase text-[10px] tracking-widest font-black">
                            {b.type === 'info' ? 'Update' : b.type}
                        </span>
                        {b.message}
                    </div>
                    <button 
                        onClick={() => setBroadcasts(prev => prev.filter(x => x.id !== b.id))}
                        className="opacity-20 hover:opacity-100 transition-opacity p-1"
                    >
                        <X size={14} />
                    </button>
                    {/* Animated shine effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                </div>
            ))}
        </div>
    );
}
