"use client";

import React from 'react';
import { Loader2 } from 'lucide-react';

interface PreloaderProps {
    message?: string;
    fullScreen?: boolean;
}

export function Preloader({ message = "Synchronizing Cluster Data...", fullScreen = false }: PreloaderProps) {
    const containerClasses = fullScreen 
        ? "fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-8"
        : "flex flex-col items-center justify-center py-32 gap-6 w-full";

    return (
        <div className={containerClasses}>
            <div className="relative">
                {/* Outer Glow */}
                <div className="absolute inset-0 blur-3xl bg-indigo-500/20 animate-pulse rounded-full" />
                
                {/* Main Spinner */}
                <div className="relative flex items-center justify-center">
                    <Loader2 className="animate-spin text-indigo-500" size={64} strokeWidth={1.5} />
                    
                    {/* Inner pulse circle */}
                    <div className="absolute w-8 h-8 bg-indigo-500/10 rounded-full animate-ping" />
                </div>
            </div>

            <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-black text-foreground/40 uppercase tracking-[0.4em] animate-pulse text-center">
                    {message}
                </p>
                
                {/* Loading Progress Bar Mockup */}
                <div className="w-32 h-[2px] bg-foreground/5 rounded-full overflow-hidden mt-2">
                    <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 w-1/2 animate-[loading-shimmer_2s_infinite_ease-in-out]" />
                </div>
            </div>

            <style jsx>{`
                @keyframes loading-shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(200%); }
                }
            `}</style>
        </div>
    );
}
