"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "@/lib/auth";
import { Shield, Lock, Loader2, User } from "lucide-react";

export default function AdminLoginPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
            const res = await fetch(`${apiUrl}/api/auth/admin-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });

            let data;
            const text = await res.text();
            try {
                data = JSON.parse(text);
            } catch (e) {
                if (!res.ok) throw new Error(`Server Error (${res.status}): ${text.substring(0, 100)}`);
                throw new Error("Invalid response from server");
            }

            if (res.ok) {
                setToken(data.access_token);
                router.push("/admin");
            } else {
                setError(data.detail || data.error || "Invalid administrative credentials.");
            }
        } catch (err) {
            setError("Connection failed. Is the backend running?");
        } finally {
            setLoading(false);
        }
    };

    if (!mounted) return null;

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] font-sans selection:bg-red-500/30">
            {/* Red glow for admin */}
            <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-red-500/5 rounded-full blur-[120px] pointer-events-none" />
            
            <div className="w-full max-w-[440px] px-6 relative z-10 animate-in fade-in duration-1000">
                <div className="bg-[#0b0c10] border border-white/[0.05] p-10 rounded-[32px] shadow-2xl relative overflow-hidden">
                    <div className="text-center mb-10">
                        <h1 className="text-[32px] font-bold text-white tracking-tight mb-2">
                            Admin Login
                        </h1>
                        <p className="text-white/40 text-sm">
                            Authorized access only
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        {error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-semibold text-center">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[13px] font-medium text-white/50 ml-1">
                                Master Password
                            </label>
                            <div className="relative group/input">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20">
                                    <Lock size={18} />
                                </div>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-[#1c2231] border border-transparent rounded-[12px] pl-12 pr-4 py-4 text-white placeholder:text-white/10 focus:outline-none transition-all"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-[#7c7fff] hover:bg-[#6c6fef] text-white font-bold py-4 rounded-[12px] transition-all disabled:opacity-50 text-base"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                            ) : (
                                "Authenticate"
                            )}
                        </button>
                    </form>
                </div>
                
                <p className="mt-8 text-center text-white/20 text-[11px] font-medium">
                    Secure Administrative Gateway
                </p>
            </div>
        </div>
    );
}
