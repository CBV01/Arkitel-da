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
                    <h2 className="text-2xl font-bold mb-1 tracking-tight text-foreground">Accounts</h2>
                    <p className="text-sm text-foreground/60">Manage your connected Telegram sessions.</p>
                </div>
                <button
                    onClick={() => setIsConnecting(true)}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 transition-all text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20 active:scale-95 flex items-center gap-2"
                >
                    <Plus size={16} /> Connect Account
                </button>
            </header>

            {/* Main Content Area */}
            {fetchingAccounts ? (
                <div className="border border-dashed border-black/10 dark:border-white/10 rounded-2xl p-16 flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                    <p className="text-sm text-foreground/60 font-medium">Loading connected accounts...</p>
                </div>
            ) : accounts.length === 0 ? (
                /* Empty State */
                <div className="bg-background/50 border border-white/5 dark:border-white/5 border-black/5 rounded-2xl p-10 flex flex-col items-center justify-center text-center shadow-xl shadow-black/5 dark:shadow-black/20 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -mr-10 -mt-10 transition-all group-hover:bg-indigo-500/10"></div>
                    <div className="w-16 h-16 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center text-foreground/40 mb-4 border border-black/5 dark:border-white/10 ring-4 ring-black/5 dark:ring-white/5">
                        <Users className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">No accounts connected</h3>
                    <p className="text-sm text-foreground/50 max-w-sm mb-6">You need to connect at least one Telegram account to start automating tasks or scraping groups.</p>
                    <button
                        onClick={() => setIsConnecting(true)}
                        className="bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-all text-foreground px-5 py-2.5 rounded-xl text-sm font-medium border border-black/5 dark:border-white/10"
                    >
                        Add your first account
                    </button>
                </div>
            ) : (
                /* Accounts Table */
                <div className="bg-background border border-white/5 dark:border-white/5 border-black/5 rounded-2xl overflow-hidden shadow-xl shadow-black/5 dark:shadow-black/20 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-black/5 dark:border-white/5 text-foreground/50 text-[11px] uppercase tracking-wider bg-black/[0.02] dark:bg-white/[0.02]">
                                <th className="font-semibold p-4 pl-6">Phone Number</th>
                                <th className="font-semibold p-4">Status</th>
                                <th className="font-semibold p-4 text-center pr-6">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5 dark:divide-white/5 whitespace-nowrap">
                            {accounts.map((acc, idx) => (
                                <tr key={idx} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group">
                                    <td className="p-4 pl-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                                                <Phone size={18} />
                                            </div>
                                            <span className="font-semibold text-sm text-foreground">{acc.phone_number}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`text-[10px] px-2 py-1 rounded-full font-bold tracking-wider uppercase border ${acc.status === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}`}>
                                            {acc.status}
                                        </span>
                                    </td>
                                    <td className="p-4 pr-6 text-center">
                                        <button className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-all">
                                            Disconnect
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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
