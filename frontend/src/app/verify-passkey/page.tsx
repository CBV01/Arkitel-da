"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@/lib/auth";
import { Lock, ShieldCheck, Loader2, ArrowRight, ShieldAlert } from "lucide-react";

export default function VerifyPasskeyPage() {
    const [passkey, setPasskey] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
        if (!getToken()) {
            router.push("/login");
        }
    }, [router]);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const res = await apiFetch("/api/auth/verify-passkey", {
                method: "POST",
                body: JSON.stringify({ passkey }),
            });

            if (res.ok) {
                router.push("/");
            } else {
                const data = await res.json();
                setError(data.detail || "Invalid system passkey. Access denied.");
            }
        } catch (err) {
            setError("Connection failed. Authentication service unavailable.");
        } finally {
            setLoading(false);
        }
    };

    if (!mounted) return null;

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] font-sans">
            <div className="w-full max-w-[440px] px-6">
                <div className="bg-[#0b0c10] border border-white/[0.05] p-12 rounded-[28px] shadow-2xl relative overflow-hidden">
                    <div className="text-center mb-10">
                        <div className="inline-flex items-center justify-center p-4 rounded-full bg-[#1c2231] mb-8">
                            <ShieldCheck className="w-8 h-8 text-[#7c7fff]" />
                        </div>
                        <h1 className="text-[32px] font-bold text-white tracking-tight mb-2">
                            Enter Passkey
                        </h1>
                        <p className="text-white/40 text-sm">
                            Please enter the global passkey to continue
                        </p>
                    </div>

                    <form onSubmit={handleVerify} className="space-y-8">
                        {error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-medium text-center">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[13px] font-medium text-white/70 ml-1">
                                Security Passkey
                            </label>
                            <div className="relative group/input mt-1.5">
                                <input
                                    type="password"
                                    value={passkey}
                                    onChange={(e) => setPasskey(e.target.value)}
                                    className="w-full bg-[#1c2231]/40 border border-white/[0.05] rounded-[10px] px-4 py-3 text-white text-center text-3xl tracking-[0.6em] placeholder:text-white/10 focus:outline-none transition-all"
                                    placeholder="••••••"
                                    maxLength={6}
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-[#7c7fff] hover:bg-[#6c6fef] text-white font-semibold py-3 rounded-[10px] transition-all disabled:opacity-50 text-[16px] mt-6"
                        >
                            {loading ? (
                                <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                            ) : (
                                "Access Dashboard"
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
