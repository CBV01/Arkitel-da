"use client";

import React, { useState, useEffect } from 'react';
import { 
    Phone, 
    KeyRound, 
    CheckCircle2, 
    Loader2, 
    X, 
    Plus, 
    AlertCircle, 
    Users,
    Rocket,
    CloudSync,
    Star,
    Check,
    Globe,
    Search,
    ChevronRight,
    ChevronDown
} from 'lucide-react';
import { apiFetch } from '@/lib/auth';
import { Preloader } from '@/components/Preloader';

const COUNTRIES = [
    { name: 'United States', code: 'US', dial: '+1', flag: '🇺🇸' },
    { name: 'United Kingdom', code: 'GB', dial: '+44', flag: '🇬🇧' },
    { name: 'Nigeria', code: 'NG', dial: '+234', flag: '🇳🇬' },
    { name: 'India', code: 'IN', dial: '+91', flag: '🇮🇳' },
    { name: 'Canada', code: 'CA', dial: '+1', flag: '🇨🇦' },
    { name: 'Germany', code: 'DE', dial: '+49', flag: '🇩🇪' },
    { name: 'France', code: 'FR', dial: '+33', flag: '🇫🇷' },
    { name: 'Australia', code: 'AU', dial: '+61', flag: '🇦🇺' },
    { name: 'Brazil', code: 'BR', dial: '+55', flag: '🇧🇷' },
    { name: 'South Africa', code: 'ZA', dial: '+27', flag: '🇿🇦' },
];

export default function AccountsPage() {
    const [isConnecting, setIsConnecting] = useState(false);
    const [step, setStep] = useState<'phone' | 'otp' | 'success'>('phone');
    const [phoneHash, setPhoneHash] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
    const [showCountrySelector, setShowCountrySelector] = useState(false);
    const [countrySearch, setCountrySearch] = useState('');
    
    // QR Login State
    const [loginMode, setLoginMode] = useState<'phone' | 'qr'>('phone');
    const [qrUrl, setQrUrl] = useState('');
    const [qrToken, setQrToken] = useState('');
    const [qrStatus, setQrStatus] = useState<'idle' | 'scanning' | 'success' | 'expired'>('idle');
    
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [accounts, setAccounts] = useState<any[]>([]);
    const [fetchingAccounts, setFetchingAccounts] = useState(true);
    const [successMsg, setSuccessMsg] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

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

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        
        // Clean phone number (remove spaces, etc)
        const cleanNumber = phoneNumber.replace(/\s+/g, '');
        const fullPhoneNumber = selectedCountry.dial + cleanNumber;

        try {
            const body: any = { phone_number: fullPhoneNumber };

            const res = await apiFetch('/api/telegram/send-code', {
                method: 'POST',
                body: JSON.stringify(body)
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
        const cleanNumber = phoneNumber.replace(/\s+/g, '');
        const fullPhoneNumber = selectedCountry.dial + cleanNumber;

        try {
            const res = await apiFetch('/api/telegram/verify-code', {
                method: 'POST',
                body: JSON.stringify({
                    phone_number: fullPhoneNumber,
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

    const handleInitQrLogin = async () => {
        setLoading(true);
        setError('');
        setLoginMode('qr');
        setQrStatus('scanning');
        try {
            const res = await apiFetch('/api/telegram/qr/init', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setQrUrl(data.url);
                setQrToken(data.token);
                // Start polling
                startQrPolling(data.token);
            } else {
                setError(data.detail || 'Failed to initialize QR login.');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const startQrPolling = async (token: string) => {
        const poll = async () => {
            if (!isConnecting || loginMode !== 'qr') return;
            try {
                const res = await apiFetch(`/api/telegram/qr/status/${token}`);
                const data = await res.json();
                if (data.status === 'success') {
                    setQrStatus('success');
                    setStep('success');
                    fetchAccounts();
                    setTimeout(() => {
                        setIsConnecting(false);
                        setStep('phone');
                        setLoginMode('phone');
                    }, 800);
                } else if (data.status === 'pending') {
                    setTimeout(poll, 2000);
                } else {
                    setQrStatus('expired');
                }
            } catch (e) {
                console.error("QR Poll error", e);
            }
        };
        poll();
    };

    const handleDeleteAccount = async (phone: string) => {
        if (!confirm(`Are you sure you want to delete ${phone}? This will permanently remove the authentication session.`)) return;
        setActionLoading(phone);
        try {
            const res = await apiFetch(`/api/telegram/accounts/${phone}`, { method: 'DELETE' });
            if (res.ok) {
                setAccounts(prev => prev.filter(a => a.phone_number !== phone));
                setSuccessMsg(`Account ${phone} removed.`);
                setTimeout(() => setSuccessMsg(''), 5000);
            }
        } catch (err) {
            console.error("Delete account error:", err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleValidateSession = async (phone: string) => {
        setActionLoading(phone + '_valid');
        try {
            const res = await apiFetch(`/api/telegram/accounts/${phone}/validate`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                if (data.authorized) {
                    setSuccessMsg(`Session for ${phone} is VALID.`);
                } else {
                    setError(`Session for ${phone} EXPIRED or INVALID.`);
                }
                setTimeout(() => setSuccessMsg(''), 5000);
            }
        } catch (err) {
            setError(`Validation failed for ${phone}.`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleSyncProfile = async (phone: string) => {
        setActionLoading(phone + '_sync');
        try {
            const res = await apiFetch(`/api/telegram/accounts/${phone}/sync`, { method: 'POST' });
            if (res.ok) {
                setSuccessMsg(`Profile for ${phone} synchronized.`);
                fetchAccounts();
                setTimeout(() => setSuccessMsg(''), 5000);
            } else {
                const data = await res.json();
                setError(data.detail || `Sync failed for ${phone}.`);
            }
        } catch (err) {
            setError(`Sync failed for ${phone}.`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleSetActive = async (phone: string) => {
        setActionLoading(phone + '_active');
        try {
            const res = await apiFetch(`/api/telegram/accounts/${phone}/active`, { method: 'POST' });
            if (res.ok) {
                setSuccessMsg(`Account ${phone} is now your primary node.`);
                fetchAccounts();
                setTimeout(() => setSuccessMsg(''), 5000);
            }
        } catch (err) {
            setError(`Failed to set ${phone} as active.`);
        } finally {
            setActionLoading(null);
        }
    };

    const handleSessionDump = async (phone: string) => {
        setActionLoading(phone + '_dump');
        try {
            const res = await apiFetch(`/api/telegram/accounts/${phone}/session`);
            if (res.ok) {
                const data = await res.json();
                await navigator.clipboard.writeText(data.session_string || '');
                setSuccessMsg(`Session key for ${phone} copied to clipboard.`);
                setTimeout(() => setSuccessMsg(''), 5000);
            } else {
                setError(`Could not export session for ${phone}.`);
            }
        } catch (err) {
            setError(`Export failed for ${phone}.`);
        } finally {
            setActionLoading(null);
        }
    };

    const filteredCountries = COUNTRIES.filter(c => 
        c.name.toLowerCase().includes(countrySearch.toLowerCase()) || 
        c.dial.includes(countrySearch)
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 min-h-screen">
            {successMsg && (
                <div className="fixed top-8 right-8 z-[100] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-6 py-4 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
                    <CheckCircle2 size={20} />
                    <span className="font-bold text-sm tracking-tight">{successMsg}</span>
                </div>
            )}

            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                <div>
                    <h2 className="text-3xl md:text-4xl font-extrabold mb-2 tracking-tight text-foreground font-sans bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/60">
                        Telegram Fleet
                    </h2>
                    <p className="text-base text-foreground/40 font-medium tracking-tight">
                        Power up your autonomous lead generation cluster.
                    </p>
                    {/* Fleet Stats Summary */}
                    <div className="flex gap-4 mt-6">
                        <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                            <span className="text-[10px] font-black uppercase text-emerald-500/60 block tracking-widest">Active Nodes</span>
                            <span className="text-lg font-black text-emerald-500">{accounts.filter(a => a.status === 'active').length}</span>
                        </div>
                        <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                            <span className="text-[10px] font-black uppercase text-amber-500/60 block tracking-widest">Resting</span>
                            <span className="text-lg font-black text-amber-500">{accounts.filter(a => a.status === 'resting').length || 0}</span>
                        </div>
                        <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
                            <span className="text-[10px] font-black uppercase text-red-500/60 block tracking-widest">Dead</span>
                            <span className="text-lg font-black text-red-500">{accounts.filter(a => a.status === 'expired' || a.status === 'banned').length}</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => {
                        setStep('phone');
                        setIsConnecting(true);
                    }}
                    className="group bg-indigo-600 hover:bg-indigo-500 transition-all text-white px-8 py-4 rounded-2xl text-sm font-bold active:scale-95 flex items-center gap-3 relative overflow-hidden shadow-2xl shadow-indigo-500/20"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                    <Plus size={20} /> Connect New Account
                </button>
            </header>


            {fetchingAccounts ? (
                <Preloader message="Synchronizing Identity Matrix..." />
            ) : accounts.length === 0 ? (
                <div className="bg-card/50 backdrop-blur-xl border border-border rounded-[48px] p-24 text-center group transition-all hover:border-indigo-500/20">
                    <div className="w-24 h-24 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-[32px] flex items-center justify-center mx-auto mb-8 text-indigo-500 transition-transform group-hover:scale-110 duration-700">
                        <Users size={48} />
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-3">No Nodes Online</h3>
                    <p className="text-base text-foreground/40 max-w-sm mx-auto mb-10 font-medium leading-relaxed">
                        Your automation cluster is currently dormant. Connect your first account to unlock autonomous broadcasting.
                    </p>
                    <button
                        onClick={() => setIsConnecting(true)}
                        className="bg-foreground/5 hover:bg-foreground/10 text-foreground/60 font-black px-10 py-5 rounded-2xl transition-all uppercase tracking-widest text-xs border border-border"
                    >
                        + Initialize Neural Link
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                    {accounts.map((acc) => (
                        <div key={acc.phone_number} className="bg-card border border-border p-6 rounded-[32px] group relative hover:shadow-2xl hover:shadow-indigo-500/5 transition-all duration-500 flex flex-col">
                                {/* Header: Status and Active Indicator */}
                                <div className="flex justify-between items-center mb-6">
                                    <span className={`px-3 py-1 text-[10px] font-bold rounded-full flex items-center gap-1.5 uppercase transition-all ${
                                        acc.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 
                                        (acc.status === 'resting' || acc.status === 'pending') ? 'bg-amber-500/10 text-amber-500' : 
                                        'bg-red-500/10 text-red-500'
                                    }`}>
                                        <div className={`w-1.5 h-1.5 rounded-full ${
                                            acc.status === 'active' ? 'bg-emerald-500 animate-pulse' : 
                                            (acc.status === 'resting' || acc.status === 'pending') ? 'bg-amber-500' : 
                                            'bg-red-500'
                                        }`} />
                                        {acc.status}
                                    </span>

                                    <div className="flex items-center gap-2">
                                        {acc.is_active ? (
                                            <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/10 text-indigo-500 rounded-full text-[10px] font-black uppercase border border-indigo-500/20 shadow-lg shadow-indigo-500/10">
                                                <Star size={12} className="fill-indigo-500" />
                                                Primary Node
                                            </div>
                                        ) : (
                                            <button 
                                                onClick={() => handleSetActive(acc.phone_number)}
                                                className="px-3 py-1 bg-white/5 hover:bg-white/10 text-foreground/40 hover:text-white rounded-full text-[10px] font-bold uppercase transition-all border border-white/5"
                                            >
                                                {actionLoading === acc.phone_number + '_active' ? <Loader2 size={10} className="animate-spin" /> : 'Use This'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                
                                {/* Profile Image and Identity */}
                                <div className="flex flex-col items-center mb-6">
                                    <div className="w-20 h-20 rounded-full border-4 border-foreground/5 p-1 mb-3 bg-foreground/[0.02] relative shadow-inner overflow-hidden flex items-center justify-center">
                                        {acc.profile_photo ? (
                                            <img 
                                                src={acc.profile_photo.startsWith('http') ? acc.profile_photo : (process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${acc.profile_photo}` : `http://localhost:8000${acc.profile_photo}`)} 
                                                className="w-full h-full rounded-full object-cover" 
                                                onError={(e) => { 
                                                    const target = e.target as any;
                                                    target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(acc.first_name || 'A')}&background=6366f1&color=fff`; 
                                                }}
                                            />
                                        ) : (
                                            <div className="w-full h-full rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                                <Users size={32} />
                                            </div>
                                        )}
                                    </div>
                                    <h4 className="text-lg font-bold text-white tracking-tight px-4 text-center">{acc.first_name || 'Account'} {acc.last_name || ''}</h4>
                                    <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-1 max-w-full truncate px-4">@{acc.username || 'unknown_node'}</p>
                                </div>

                                {/* Info Grid */}
                                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-5 mb-auto space-y-4">
                                    <div className="flex items-center justify-between text-[10px] font-bold text-foreground/30 uppercase tracking-tighter">
                                        <span className="flex items-center gap-1.5 font-black text-white/20"><Rocket size={10} className="opacity-50" /> #CH_{acc.phone_number.slice(-4)}</span>
                                        <span className="flex items-center gap-1.5 bg-white/5 px-2 py-0.5 rounded-full"><Globe size={10} className="opacity-50" /> {acc.country || 'Global'}</span>
                                    </div>
                                    
                                    <div className="flex flex-col gap-2.5">
                                        <div className="flex items-center gap-3 text-xs font-bold text-foreground/70">
                                            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-500"><Phone size={14} /></div>
                                            {acc.phone_number}
                                        </div>
                                        
                                        {/* Action Cluster - High end layout */}
                                        <div className="grid grid-cols-4 gap-2 pt-3 mt-1 border-t border-white/5">
                                            <button 
                                                onClick={() => handleSyncProfile(acc.phone_number)}
                                                className="col-span-1 p-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 rounded-2xl flex items-center justify-center transition-all border border-indigo-500/10"
                                                title="Sync Profile"
                                            >
                                                {actionLoading === acc.phone_number + '_sync' ? <Loader2 size={14} className="animate-spin" /> : <CloudSync size={16} />}
                                            </button>
                                            <button 
                                                onClick={() => handleValidateSession(acc.phone_number)}
                                                className="col-span-1 p-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-2xl flex items-center justify-center transition-all border border-emerald-500/10"
                                                title="Pulse Check"
                                            >
                                                {actionLoading === acc.phone_number + '_valid' ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={16} />}
                                            </button>
                                            <button 
                                                onClick={() => handleSessionDump(acc.phone_number)}
                                                className="col-span-1 p-3 bg-white/5 hover:bg-white/10 text-white/40 rounded-2xl flex items-center justify-center transition-all border border-white/10"
                                                title="Export Key"
                                            >
                                                {actionLoading === acc.phone_number + '_dump' ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={16} />}
                                            </button>
                                            <button 
                                                onClick={() => handleDeleteAccount(acc.phone_number)}
                                                className="col-span-1 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl flex items-center justify-center transition-all border border-red-500/10"
                                                title="Delete"
                                            >
                                                {actionLoading === acc.phone_number ? <Loader2 size={14} className="animate-spin" /> : <X size={16} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="h-px bg-border/20 my-1" />

                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-1.5 text-[9px] font-black text-foreground/30 uppercase">
                                            <CheckCircle2 size={12} className="text-emerald-500" />
                                            Identity Lock
                                        </div>
                                        {acc.status_detail && (
                                            <p className="text-[8px] text-foreground/40 italic ml-4 leading-tight">{acc.status_detail}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="flex items-center gap-1.5 text-[9px] font-black text-foreground/30 uppercase">
                                            <Rocket size={12} className="text-indigo-500" />
                                            Last Active
                                        </div>
                                        <span className="text-[8px] font-bold text-foreground/20">
                                            {acc.last_active ? new Date(acc.last_active).toLocaleTimeString() : 'N/A'}
                                        </span>
                                    </div>
                                </div>
                            
                                {/* Joined Footer */}
                                <div className="flex items-center justify-between pt-5 mt-5 border-t border-border/10">
                                    <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.1em]">Joined {acc.created_at ? new Date(acc.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recently'}</span>
                                    <button className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-400 flex items-center gap-1 transition-all group/btn">
                                        View Details <ChevronRight size={10} className="group-hover/btn:translate-x-1 transition-transform" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
            )}

            {/* Premium Connection Modal Overay */}
            {isConnecting && (
                <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="relative w-full max-w-[380px]">
                        
                        <div className="relative bg-card border border-border rounded-[32px] w-full overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-400">
                            {/* Close Button */}
                            <button
                                onClick={() => { setIsConnecting(false); setStep('phone'); setError(''); }}
                                className="absolute top-5 right-5 z-20 text-foreground/40 hover:text-foreground transition-colors p-2 bg-foreground/5 rounded-full"
                            >
                                <X size={18} />
                            </button>

                            {/* Modal Content */}
                            <div className="p-8">
                                {step === 'phone' && (
                                    <div className="text-center">
                                        {/* Icon */}
                                        <div className="mb-6 relative inline-block">
                                            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full scale-150" />
                                            <div className="relative w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center transform -rotate-6">
                                                <Rocket className="text-white" size={28} />
                                            </div>
                                        </div>

                                        <h3 className="text-2xl font-bold text-foreground mb-2 tracking-tight">Connect Account</h3>
                                        <p className="text-foreground/50 text-xs font-medium mb-6 max-w-[280px] mx-auto leading-relaxed">
                                            Choose your preferred method to link your Telegram node.
                                        </p>

                                        <div className="flex bg-foreground/5 p-1 rounded-xl mb-6">
                                            <button 
                                                onClick={() => setLoginMode('phone')}
                                                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${loginMode === 'phone' ? 'bg-indigo-600 text-white' : 'text-foreground/50 hover:text-foreground/80'}`}
                                            >
                                                Phone Number
                                            </button>
                                            <button 
                                                onClick={handleInitQrLogin}
                                                className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${loginMode === 'qr' ? 'bg-indigo-600 text-white' : 'text-foreground/50 hover:text-foreground/80'}`}
                                            >
                                                QR Code
                                            </button>
                                        </div>

                                        {error && (
                                            <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-[11px] font-bold flex items-center gap-2 animate-in shake duration-500 text-left">
                                                <AlertCircle size={14} className="shrink-0" />
                                                <span>{error}</span>
                                            </div>
                                        )}

                                        {loginMode === 'phone' ? (
                                            <form onSubmit={handleSendCode} className="space-y-6 text-left">
                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/40 flex items-center gap-2 px-1">
                                                        <Phone size={10} className="text-indigo-500" />
                                                        Your Telegram Number
                                                    </label>
                                                    
                                                    <div className="flex gap-2">
                                                        {/* Country Selector */}
                                                        <div className="relative">
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowCountrySelector(!showCountrySelector)}
                                                                className="h-12 px-3 bg-foreground/5 border border-border rounded-xl flex items-center gap-2 hover:bg-foreground/10 transition-all group"
                                                            >
                                                                <span className="text-base">{selectedCountry.flag}</span>
                                                                <span className="text-foreground font-bold text-xs">{selectedCountry.code}</span>
                                                                <span className="text-foreground/50 font-medium text-xs">{selectedCountry.dial}</span>
                                                                <ChevronDown size={14} className={`text-foreground/30 transition-transform duration-300 ${showCountrySelector ? 'rotate-180' : ''}`} />
                                                            </button>

                                                            {showCountrySelector && (
                                                                <>
                                                                    <div 
                                                                        className="fixed inset-0 z-30" 
                                                                        onClick={() => setShowCountrySelector(false)} 
                                                                    />
                                                                    <div className="absolute top-full left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-2xl z-40 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                                                        <div className="p-2 border-b border-border">
                                                                            <div className="relative">
                                                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30" size={12} />
                                                                                <input 
                                                                                    type="text"
                                                                                    placeholder="Search countries..."
                                                                                    className="w-full bg-foreground/5 border-none rounded-lg py-1.5 pl-8 pr-3 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                                                                                    value={countrySearch}
                                                                                    onChange={(e) => setCountrySearch(e.target.value)}
                                                                                    autoFocus
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        <div className="max-h-52 overflow-y-auto custom-scrollbar bg-card">
                                                                            {filteredCountries.map((c) => (
                                                                                <button
                                                                                    key={c.code}
                                                                                    type="button"
                                                                                    className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-foreground/5 transition-colors"
                                                                                    onClick={() => {
                                                                                        setSelectedCountry(c);
                                                                                        setShowCountrySelector(false);
                                                                                        setCountrySearch('');
                                                                                    }}
                                                                                >
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="text-base">{c.flag}</span>
                                                                                        <span className="text-xs font-medium text-foreground/80">{c.name}</span>
                                                                                    </div>
                                                                                    <span className="text-[10px] font-bold text-foreground/40">{c.dial}</span>
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>

                                                        {/* Phone Input */}
                                                        <div className="flex-1 relative">
                                                            <input
                                                                type="text"
                                                                value={phoneNumber}
                                                                onChange={(e) => setPhoneNumber(e.target.value)}
                                                                placeholder="234 567 8900"
                                                                className="w-full h-12 bg-foreground/5 border border-border rounded-xl px-4 text-sm font-medium text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:bg-background transition-all"
                                                                required
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <button
                                                    type="submit"
                                                    disabled={loading || !phoneNumber}
                                                    className="w-full h-12 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-50 disabled:grayscale text-white rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.98] group"
                                                >
                                                    {loading ? (
                                                        <Loader2 size={20} className="animate-spin" />
                                                    ) : (
                                                        <>
                                                            Send Login Code
                                                            <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                                                        </>
                                                    )}
                                                </button>

                                                <p className="text-center text-[9px] text-foreground/20 font-bold uppercase tracking-widest mt-6">
                                                    We'll send a secure code to your Telegram app.
                                                </p>
                                            </form>
                                        ) : (
                                            <div className="space-y-6 animate-in fade-in duration-500">
                                                <div className="relative mx-auto w-48 h-48 bg-white border border-border rounded-2xl p-3 group overflow-hidden">
                                                    {qrUrl ? (
                                                        <img 
                                                            src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&margin=0&data=${encodeURIComponent(qrUrl)}`} 
                                                            alt="QR"
                                                            className={`w-full h-full object-contain transition-opacity duration-1000 ${qrStatus === 'success' ? 'opacity-20' : 'opacity-100'}`}
                                                            onError={(e) => {
                                                                (e.target as any).src = `https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=${encodeURIComponent(qrUrl)}`;
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                                                            <Loader2 size={24} className="animate-spin text-indigo-500" />
                                                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Generating</span>
                                                        </div>
                                                    )}
                                                    
                                                    {qrStatus === 'success' && (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 animate-in zoom-in-95 duration-500 bg-background/80 backdrop-blur-sm rounded-3xl">
                                                            <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center">
                                                                <CheckCircle2 size={32} className="text-emerald-500" />
                                                            </div>
                                                            <span className="text-sm font-bold text-emerald-500">Authorized!</span>
                                                        </div>
                                                    )}
                                                    
                                                    {qrStatus === 'expired' && (
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm rounded-3xl animate-in fade-in duration-300">
                                                            <X size={32} className="text-red-500" />
                                                            <span className="text-sm font-bold text-white">QR Expired</span>
                                                            <button 
                                                                onClick={handleInitQrLogin}
                                                                className="mt-2 text-[10px] font-black uppercase tracking-widest text-indigo-400 bg-foreground/10 px-4 py-2 rounded-xl"
                                                            >
                                                                Regenerate
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                <div className="pt-2">
                                                    <p className="text-[10px] text-foreground/40 font-medium leading-relaxed px-4">
                                                        Scan with <b className="text-foreground">Telegram &gt; Settings &gt; Devices</b> to link instantly.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {step === 'otp' && (
                                    <div className="text-center">
                                        {/* Icon */}
                                        <div className="mb-8 relative inline-block">
                                            <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full scale-150" />
                                            <div className="relative w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center transform rotate-6">
                                                <KeyRound className="text-white fill-white/10" size={32} />
                                            </div>
                                        </div>

                                        <h3 className="text-2xl font-bold text-foreground mb-2 tracking-tight">Security Code</h3>
                                        <p className="text-foreground/40 text-[11px] font-bold mb-8 max-w-[240px] mx-auto leading-relaxed uppercase tracking-tighter">
                                            Enter the 5-digit verification code sent to your active Telegram session.
                                        </p>

                                        {error && (
                                            <div className="mb-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-bold flex items-center gap-2 animate-in shake duration-500 text-left">
                                                <AlertCircle size={14} className="shrink-0" />
                                                <span>{error}</span>
                                            </div>
                                        )}

                                        <form onSubmit={handleVerifyCode} className="space-y-6">
                                            <div className="flex justify-center">
                                                <input
                                                    type="text"
                                                    value={otp}
                                                    onChange={(e) => setOtp(e.target.value)}
                                                    placeholder="•••••"
                                                    maxLength={5}
                                                    className="w-full h-14 bg-foreground/5 border border-border rounded-xl text-center text-2xl font-black tracking-[0.5em] text-foreground focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:bg-foreground/10 transition-all"
                                                    required
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="flex flex-col gap-3">
                                                <button
                                                    type="submit"
                                                    disabled={loading || otp.length < 5}
                                                    className="w-full h-12 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 text-sm font-bold transition-all rounded-xl flex items-center justify-center gap-2 active:scale-[0.98]"
                                                >
                                                    {loading ? <Loader2 size={18} className="animate-spin" /> : 'Link Account'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setStep('phone')}
                                                    className="text-foreground/30 hover:text-foreground text-[10px] font-bold uppercase tracking-widest transition-colors py-1"
                                                >
                                                    ← Change Number
                                                </button>
                                            </div>
                                        </form>
                                    </div>
                                )}

                                {step === 'success' && (
                                    <div className="text-center py-8 animate-in zoom-in-95 duration-500">
                                        <div className="mb-10 relative inline-block">
                                            <div className="absolute inset-0 bg-emerald-500/30 blur-2xl rounded-full scale-150 animate-pulse" />
                                            <div className="relative w-24 h-24 bg-gradient-to-br from-emerald-400 to-teal-600 rounded-[32px] flex items-center justify-center shadow-2xl shadow-emerald-500/40">
                                                <CheckCircle2 className="text-white" size={48} />
                                            </div>
                                        </div>
                                        <h4 className="text-2xl font-black text-foreground mb-4 tracking-tighter uppercase">Authorized</h4>
                                        <p className="text-foreground/40 text-[11px] font-medium leading-relaxed max-w-[240px] mx-auto mb-10">
                                            Neural Link Established. Synchronizing Cluster Data...
                                        </p>
                                        <div className="w-full h-1 bg-foreground/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-indigo-500 animate-loading-bar" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
                @keyframes loading-bar {
                    0% { width: 0%; }
                    100% { width: 100%; }
                }
                .animate-shimmer {
                    animation: shimmer 1.5s infinite;
                }
                .animate-loading-bar {
                    animation: loading-bar 2s ease-in-out forwards;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </div>
    );
}
