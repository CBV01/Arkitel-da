"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { User, Lock, KeyRound, Loader2, ArrowRight, ShieldCheck, Mail } from "lucide-react";

export default function RegisterPage() {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
            const res = await fetch(`${apiUrl}/api/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });

            const data = await res.json();
            if (res.ok) {
                router.push("/login");
            } else {
                setError(data.detail || "Registration failed. Email might be taken.");
            }
        } catch (err) {
            setError("Connection failed. Is the backend running?");
        } finally {
            setLoading(false);
        }
    };

    if (!mounted) return null;

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] font-sans">
            <div className="w-full max-w-[480px] px-6">
                <div className="bg-[#0b0c10] border border-white/[0.05] p-10 rounded-[28px] shadow-2xl relative overflow-hidden">
                    <div className="text-center mb-10">
                        <h1 className="text-[32px] font-bold text-white tracking-tight mb-2">
                            Create Account
                        </h1>
                        <p className="text-white/40 text-sm">
                            Join the next generation of automation
                        </p>
                    </div>

                    <form onSubmit={handleRegister} className="space-y-6">
                        {error && (
                            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-medium text-center">
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[13px] font-medium text-white/70 ml-1">
                                Email Address
                            </label>
                            <div className="relative group/input">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                                    <Mail size={18} />
                                </div>
                                <input
                                    type="email"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-[#1c2231] border border-transparent rounded-[10px] pl-12 pr-4 py-3.5 text-white placeholder:text-white/20 focus:outline-none transition-all text-sm"
                                    placeholder="name@example.com"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[13px] font-medium text-white/70 ml-1">
                                    Password
                                </label>
                                <div className="relative group/input">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                                        <Lock size={16} />
                                    </div>
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-[#1c2231] border border-transparent rounded-[10px] pl-11 pr-4 py-3.5 text-white placeholder:text-white/20 focus:outline-none transition-all text-xs"
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[13px] font-medium text-white/70 ml-1">
                                    Confirm
                                </label>
                                <div className="relative group/input">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30">
                                        <KeyRound size={16} />
                                    </div>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-[#1c2231] border border-transparent rounded-[10px] pl-11 pr-4 py-3.5 text-white placeholder:text-white/20 focus:outline-none transition-all text-xs"
                                        placeholder="••••••••"
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-[#7c7fff] hover:bg-[#6c6fef] text-white font-semibold py-4 rounded-[10px] transition-all disabled:opacity-50 text-[15px]"
                        >
                            {loading ? (
                                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                            ) : (
                                "Initialize Identity"
                            )}
                        </button>
                    </form>

                    <div className="mt-8 text-center">
                        <p className="text-white/40 text-sm font-medium">
                            Already part of the fleet?{" "}
                            <Link
                                href="/login"
                                className="text-white/50 hover:text-white transition-colors"
                            >
                                Sign in
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
