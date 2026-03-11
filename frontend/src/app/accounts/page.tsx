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
    ChevronRight,
    Globe,
    ChevronDown,
    Search
} from 'lucide-react';
import { apiFetch } from '@/lib/auth';

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
            const text = await res.text();
            if (res.ok) {
                try {
                    const data = JSON.parse(text);
                    setAccounts(data.accounts || []);
                } catch (e) {
                    console.error("Accounts: Non-JSON response:", text);
                }
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
                    }, 2000);
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
                </div>
                <button
                    onClick={() => {
                        setStep('phone');
                        setIsConnecting(true);
                    }}
                    className="group bg-indigo-600 hover:bg-indigo-500 transition-all text-white px-8 py-4 rounded-2xl text-sm font-bold active:scale-95 flex items-center gap-3 relative overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                    <Plus size={20} /> Connect New Account
                </button>
            </header>

            {fetchingAccounts ? (
                <div className="flex flex-col items-center justify-center py-32 gap-6">
                    <div className="relative">
                        <Loader2 className="animate-spin text-indigo-500" size={64} />
                        <div className="absolute inset-0 blur-2xl bg-indigo-500/20 animate-pulse rounded-full" />
                    </div>
                    <p className="text-xs font-black text-foreground/30 uppercase tracking-[0.3em] animate-pulse">
                        Synchronizing Identity Matrix...
                    </p>
                </div>
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                    {accounts.map((acc, idx) => (
                        <div key={idx} className="bg-card/60 backdrop-blur-2xl border border-border rounded-[36px] p-8 group hover:border-indigo-500/30 transition-all relative overflow-hidden flex flex-col">
                            <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 transition-all group-hover:bg-indigo-500/20"></div>

                            <div className="flex items-center gap-6 mb-8 relative z-10">
                                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-black transition-all group-hover:rotate-6 group-hover:scale-110 duration-500">
                                    {(acc.phone_number?.slice(-2) || 'N').toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-bold text-foreground text-xl tracking-tight truncate mb-1">
                                        {acc.phone_number}
                                    </h4>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-[pulse_2s_infinite]"></div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500/80">CORE ONLINE</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteAccount(acc.phone_number)}
                                    disabled={actionLoading === acc.phone_number}
                                    className="p-3 rounded-2xl bg-foreground/5 text-foreground/20 hover:text-red-400 hover:bg-red-400/10 transition-all border border-border disabled:opacity-50">
                                    {actionLoading === acc.phone_number ? <Loader2 size={20} className="animate-spin" /> : <X size={20} />}
                                </button>
                            </div>

                            <div className="space-y-4 relative z-10 mb-8 flex-1">
                                <div className="flex justify-between items-center py-4 border-b border-border/50">
                                    <span className="text-[11px] font-bold text-foreground/30 uppercase tracking-[0.1em]">Identity Lock</span>
                                    <span className="text-xs font-mono font-medium text-foreground/60 bg-foreground/5 px-2 py-1 rounded-md">API-{acc.api_id?.slice(0, 4) || '••••'}</span>
                                </div>
                                <div className="flex justify-between items-center py-2">
                                    <span className="text-[11px] font-bold text-foreground/30 uppercase tracking-[0.1em]">Traffic Capacity</span>
                                    <div className="flex items-center gap-2">
                                        <div className="w-12 h-1.5 bg-foreground/5 rounded-full overflow-hidden">
                                            <div className="w-3/4 h-full bg-indigo-500 rounded-full" />
                                        </div>
                                        <span className="text-[10px] font-bold text-foreground/80">OPTIMAL</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 relative z-10">
                                <button
                                    onClick={() => handleSessionDump(acc.phone_number)}
                                    className="bg-foreground/5 hover:bg-foreground/10 text-foreground/40 hover:text-foreground transition-all py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] border border-border">
                                    Export Key
                                </button>
                                <button
                                    onClick={() => handleValidateSession(acc.phone_number)}
                                    disabled={actionLoading === acc.phone_number + '_valid'}
                                    className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 transition-all py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] border border-indigo-500/10 disabled:opacity-50">
                                    {actionLoading === acc.phone_number + '_valid' ? 'Verifying...' : 'Pulse Check'}
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

                                        <h3 className="text-3xl font-bold text-foreground mb-3 tracking-tight">Security Code</h3>
                                        <p className="text-foreground/40 text-sm font-medium mb-12 max-w-[280px] mx-auto leading-relaxed">
                                            Enter the 5-digit verification code sent to your active Telegram session.
                                        </p>

                                        {error && (
                                            <div className="mb-8 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold flex items-center gap-3 animate-in shake duration-500">
                                                <AlertCircle size={16} className="shrink-0" />
                                                <span>{error}</span>
                                            </div>
                                        )}

                                        <form onSubmit={handleVerifyCode} className="space-y-10">
                                            <div className="flex justify-center gap-4">
                                                <input
                                                    type="text"
                                                    value={otp}
                                                    onChange={(e) => setOtp(e.target.value)}
                                                    placeholder="•••••"
                                                    maxLength={5}
                                                    className="w-full h-20 bg-foreground/5 border border-border rounded-[24px] text-center text-4xl font-black tracking-[0.5em] text-foreground focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:bg-foreground/10 transition-all"
                                                    required
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="flex flex-col gap-4">
                                                <button
                                                    type="submit"
                                                    disabled={loading || otp.length < 5}
                                                    className="w-full h-16 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-30 text-base font-bold transition-all rounded-[20px] flex items-center justify-center gap-3 active:scale-[0.98]"
                                                >
                                                    {loading ? <Loader2 size={24} className="animate-spin" /> : 'Complete Link'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setStep('phone')}
                                                    className="text-foreground/40 hover:text-foreground text-[11px] font-black uppercase tracking-widest transition-colors py-2"
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
