"use client";

import React, { useState } from 'react';
import { Phone, KeyRound, CheckCircle2, Loader2, X, Plus, AlertCircle, Users } from 'lucide-react';
import { apiFetch } from '@/lib/auth';

export default function AccountsPage() {
    const [isConnecting, setIsConnecting] = useState(false);
    const [step, setStep] = useState<'phone' | 'otp' | 'success'>('phone');
    const [phoneHash, setPhoneHash] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [apiId, setApiId] = useState('');
    const [apiHash, setApiHash] = useState('');
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [fetchingAccounts, setFetchingAccounts] = useState(true);

    const fetchAccounts = async () => {
        setFetchingAccounts(true);
        try {
            const res = await apiFetch('/api/telegram/accounts');
            const data = await res.json();
            if (res.ok) {
                setAccounts(data.accounts || []);
            }
        } catch (err) {
            console.error("Failed to fetch accounts:", err);
        } finally {
            setFetchingAccounts(false);
        }
    };

    React.useEffect(() => {
        fetchAccounts();
    }, []);

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/telegram/send-code', {
                method: 'POST',
                body: JSON.stringify({
                    phone_number: phoneNumber,
                    api_id: apiId,
                    api_hash: apiHash
                })
            });
            let data;
            const text = await res.text();
            try {
                data = JSON.parse(text);
            } catch (e) {
                if (!res.ok) throw new Error(`Server Error (${res.status}): ${text.substring(0, 100)}`);
                throw new Error("Invalid response from server");
            }

            if (!res.ok) throw new Error(data.detail || data.error || 'Failed to send code');

            setPhoneHash(data.phone_code_hash);
            setStep('otp');
        } catch (err: any) {
            const msg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/telegram/verify-code', {
                method: 'POST',
                body: JSON.stringify({
                    phone_number: phoneNumber,
                    phone_code_hash: phoneHash,
                    code: otp
                })
            });
            let data;
            const text = await res.text();
            try {
                data = JSON.parse(text);
            } catch (e) {
                if (!res.ok) throw new Error(`Server Error (${res.status}): ${text.substring(0, 100)}`);
                throw new Error("Invalid response from server");
            }

            if (!res.ok) throw new Error(data.detail || data.error || 'Failed to verify code');

            setStep('success');
            fetchAccounts();
            setTimeout(() => {
                setIsConnecting(false);
                setStep('phone');
                setPhoneNumber('');
                setOtp('');
            }, 2000);
        } catch (err: any) {
            const msg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="flex justify-between items-center mb-10">
                <div>
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-white font-sans">Telegram Fleet</h2>
                    <p className="text-sm text-white/40 font-medium tracking-tight">Manage your autonomous identity cluster.</p>
                </div>
                <button
                    onClick={() => {
                        setStep('phone');
                        setIsConnecting(true);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 transition-all text-white px-6 py-3 rounded-2xl text-sm font-bold shadow-xl shadow-indigo-500/20 active:scale-95 flex items-center gap-2"
                >
                    <Plus size={18} /> Connect New Account
                </button>
            </header>

            {fetchingAccounts ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <Loader2 className="animate-spin text-indigo-500/40" size={40} />
                    <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">Accessing Fleet Data...</p>
                </div>
            ) : accounts.length === 0 ? (
                <div className="bg-[#0b0c10] border border-dashed border-white/10 rounded-[32px] p-24 text-center shadow-2xl">
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6 text-white/10">
                        <Users size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">No Active Accounts</h3>
                    <p className="text-sm text-white/30 max-w-xs mx-auto mb-8 font-medium italic">Your automation cluster is currently empty. Connect your first account to begin broadcasting.</p>
                    <button
                        onClick={() => setIsConnecting(true)}
                        className="text-indigo-400 font-bold hover:text-indigo-300 transition-colors uppercase tracking-widest text-xs"
                    >
                        + Initialize First Node
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    {accounts.map((acc, idx) => (
                        <div key={idx} className="bg-[#0b0c10] border border-white/5 rounded-[28px] p-6 group hover:border-indigo-500/30 transition-all shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-indigo-500/10"></div>
                            
                            <div className="flex items-center gap-4 mb-6 relative z-10">
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-indigo-500/10 transition-transform group-hover:scale-105 duration-500">
                                    {(acc.phone_number?.slice(-2) || 'N').toUpperCase()}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <h4 className="font-bold text-white text-lg tracking-tight truncate">{acc.phone_number}</h4>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500/70">NODE ACTIVE</span>
                                    </div>
                                </div>
                                <button className="p-2.5 rounded-xl bg-white/5 text-white/20 hover:text-red-400 hover:bg-red-400/10 transition-all border border-white/5">
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="space-y-4 relative z-10">
                                <div className="flex justify-between items-center py-3 border-b border-white/5">
                                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.1em]">Identity Lock</span>
                                    <span className="text-xs font-mono text-white/60">API-{acc.api_id?.slice(0, 4) || '••••'}</span>
                                </div>
                                <div className="flex justify-between items-center py-1">
                                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.1em]">Payload Capacity</span>
                                    <span className="text-xs font-bold text-white/80">Unlimited</span>
                                </div>
                            </div>

                            <div className="mt-6 pt-6 border-t border-white/5 flex gap-2 relative z-10">
                                <button className="flex-1 bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-all py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/5">
                                    Session Dump
                                </button>
                                <button className="flex-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-all py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border border-indigo-500/10">
                                    Auth Valid
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Connection Modal Overlay */}
            {isConnecting && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-background border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="flex justify-between items-center p-6 border-b border-white/5">
                            <h3 className="font-semibold text-lg text-foreground">Connect Telegram</h3>
                            <button
                                onClick={() => { setIsConnecting(false); setStep('phone'); setError(''); }}
                                className="text-foreground/50 hover:text-foreground transition-colors p-1"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6">
                            {error && (
                                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-start gap-2">
                                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            {step === 'phone' && (
                                <form onSubmit={handleSendCode} className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-foreground/80">Phone Number</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-foreground/40">
                                                <Phone size={16} />
                                            </div>
                                            <input
                                                type="tel"
                                                value={phoneNumber}
                                                onChange={(e) => setPhoneNumber(e.target.value)}
                                                placeholder="+1234567890"
                                                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                required
                                                suppressHydrationWarning={true}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-foreground/80">API ID</label>
                                            <input
                                                type="text"
                                                value={apiId}
                                                onChange={(e) => setApiId(e.target.value)}
                                                placeholder="123456"
                                                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                required
                                                suppressHydrationWarning={true}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-foreground/80">API Hash</label>
                                            <input
                                                type="text"
                                                value={apiHash}
                                                onChange={(e) => setApiHash(e.target.value)}
                                                placeholder="a1b2c3..."
                                                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl py-2.5 px-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                required
                                                suppressHydrationWarning={true}
                                            />
                                        </div>
                                    </div>

                                    <p className="text-[11px] text-foreground/40 leading-relaxed">
                                        Get your credentials from <a href="https://my.telegram.org" target="_blank" className="text-indigo-500 hover:underline">my.telegram.org</a>.
                                    </p>
                                    <button
                                        type="submit"
                                        disabled={loading || !phoneNumber}
                                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                                    >
                                        {loading ? <Loader2 size={16} className="animate-spin" /> : 'Send Code'}
                                    </button>
                                </form>
                            )}

                            {step === 'otp' && (
                                <form onSubmit={handleVerifyCode} className="space-y-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-foreground/80">Verification Code</label>
                                        <div className="relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-foreground/40">
                                                <KeyRound size={16} />
                                            </div>
                                            <input
                                                type="text"
                                                value={otp}
                                                onChange={(e) => setOtp(e.target.value)}
                                                placeholder="12345"
                                                className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                required
                                            />
                                        </div>
                                        <p className="text-xs text-foreground/50">Enter the code sent to your Telegram app.</p>
                                    </div>
                                    <div className="flex gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setStep('phone')}
                                            className="w-1/3 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-foreground py-2.5 rounded-xl text-sm font-semibold transition-all"
                                        >
                                            Back
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={loading || !otp}
                                            className="w-2/3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                                        >
                                            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Verify Code'}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {step === 'success' && (
                                <div className="text-center py-6 animate-in zoom-in-95 duration-300">
                                    <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 ring-8 ring-emerald-500/5">
                                        <CheckCircle2 size={32} />
                                    </div>
                                    <h4 className="text-lg font-bold text-foreground mb-2">Account Connected!</h4>
                                    <p className="text-sm text-foreground/60 mb-6">Your Telegram session has been successfully securely stored.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
