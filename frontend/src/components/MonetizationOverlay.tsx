'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/auth';
import { Lock, Ticket, CreditCard, CheckCircle2, X, AlertCircle } from 'lucide-react';

interface MonetizationOverlayProps {
    children: React.ReactNode;
    featureName: string;
}

export const MonetizationOverlay: React.FC<MonetizationOverlayProps> = ({ children, featureName }) => {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [couponCode, setCouponCode] = useState('');
    const [applying, setApplying] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });
    const [showProofForm, setShowProofForm] = useState(false);
    const [proof, setProof] = useState({ name: '', bank: '', amount: 5000 });

    const fetchStatus = async () => {
        try {
            const res = await apiFetch('/api/monetization/status');
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
            }
        } catch (e) {
            console.error("Failed to fetch monetization status");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    const applyCoupon = async () => {
        if (!couponCode) return;
        setApplying(true);
        setMsg({ type: '', text: '' });
        try {
            const res = await apiFetch(`/api/monetization/apply-coupon?code=${couponCode}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                if (data.discount === 'free') {
                    setMsg({ type: 'success', text: "Premium Activated! Refreshing..." });
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    setMsg({ type: 'success', text: data.message });
                    setProof({ ...proof, amount: data.new_price });
                }
            } else {
                setMsg({ type: 'error', text: data.detail || "Invalid code" });
            }
        } catch (e) {
            setMsg({ type: 'error', text: "Server error" });
        } finally {
            setApplying(false);
        }
    };

    const submitProof = async () => {
        if (!proof.name || !proof.bank) return;
        setApplying(true);
        try {
            const proofStr = `${proof.name} | ${proof.bank} | #${proof.amount}`;
            const res = await apiFetch('/api/monetization/submit-proof', {
                method: 'POST',
                body: JSON.stringify({ proof_details: proofStr, amount: proof.amount })
            });
            if (res.ok) {
                setMsg({ type: 'success', text: "Proof submitted! Admin will verify soon." });
                setStatus({ ...status, has_proof: true });
                setShowProofForm(false);
            }
        } catch (e) {
            setMsg({ type: 'error', text: "Failed to submit" });
        } finally {
            setApplying(false);
        }
    };

    if (loading) return <>{children}</>;

    const isLocked = status?.plan === 'free';

    return (
        <div className="relative w-full h-full min-h-[400px]">
            {children}

            {isLocked && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-4 overflow-hidden rounded-[inherit]">
                    {/* Glass Backdrop */}
                    <div className="absolute inset-0 bg-background/60 backdrop-blur-xl" />
                    
                    {/* Subtle Glows */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px]" />

                    <div className="relative w-full max-w-[400px] bg-card/80 border border-white/10 p-8 rounded-[40px] shadow-2xl flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-500">
                        <div className="relative">
                            <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 animate-pulse" />
                            <div className="relative w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-xl">
                                <Lock size={28} />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-2xl font-black tracking-tight leading-none text-white">
                                Arkitel <span className="text-indigo-400">Premium Vault</span>
                            </h2>
                            <p className="text-foreground/40 text-[10px] font-bold uppercase tracking-[0.2em] px-4">
                                Exclusive Access Only
                            </p>
                        </div>

                        <div className="w-full space-y-4">
                            {!status?.has_proof ? (
                                <>
                                    {!showProofForm ? (
                                        <>
                                            <div className="bg-white/5 border border-white/5 p-4 rounded-2xl space-y-3">
                                                <div className="flex items-center justify-between text-xs font-bold">
                                                    <span className="text-foreground/30 uppercase tracking-widest text-[9px]">LIFETIME ACCESS</span>
                                                    <span className="text-lg tabular-nums">#5,000.00</span>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        const url = 'https://paystack.com/pay/arkitel-premium';
                                                        window.open(url, '_blank');
                                                        setShowProofForm(true);
                                                    }}
                                                    className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-indigo-500/20 active:scale-95"
                                                >
                                                    <CreditCard size={16} /> Pay with Paystack
                                                </button>
                                            </div>

                                            <div className="flex items-center gap-3 px-2">
                                                <div className="h-px flex-1 bg-white/5" />
                                                <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest whitespace-nowrap">Redeem Code</span>
                                                <div className="h-px flex-1 bg-white/5" />
                                            </div>

                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30" size={14} />
                                                    <input 
                                                        type="text" 
                                                        placeholder="Voucher..."
                                                        value={couponCode}
                                                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-3 text-xs font-bold focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                                    />
                                                </div>
                                                <button 
                                                    onClick={applyCoupon}
                                                    disabled={applying || !couponCode}
                                                    className="px-4 rounded-xl bg-white/5 border border-white/5 text-foreground/60 text-xs font-bold hover:bg-indigo-500 hover:text-white transition-all disabled:opacity-30 active:scale-95"
                                                >
                                                    {applying ? '...' : 'Apply'}
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="bg-white/5 border border-white/10 p-5 rounded-3xl space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                                            <div className="flex items-center justify-between px-1">
                                                <h3 className="font-bold text-xs uppercase tracking-widest text-foreground/40">Proof Submission</h3>
                                                <button onClick={() => setShowProofForm(false)} className="text-foreground/40 hover:text-foreground"><X size={14} /></button>
                                            </div>
                                            <div className="space-y-2">
                                                <input 
                                                    placeholder="Account Name Used"
                                                    className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-500/50"
                                                    onChange={(e) => setProof({...proof, name: e.target.value})}
                                                />
                                                <input 
                                                    placeholder="Your Bank Name"
                                                    className="w-full bg-black/40 border border-white/5 rounded-xl px-4 py-3 text-xs outline-none focus:border-indigo-500/50"
                                                    onChange={(e) => setProof({...proof, bank: e.target.value})}
                                                />
                                            </div>
                                            <button 
                                                onClick={submitProof}
                                                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-xl transition-all text-xs shadow-lg shadow-emerald-500/20 active:scale-95"
                                            >
                                                Confirm Deposit
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="bg-emerald-500/5 border border-emerald-500/10 p-6 rounded-3xl flex flex-col items-center space-y-3">
                                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                        <CheckCircle2 size={20} />
                                    </div>
                                    <p className="font-bold text-xs text-emerald-400">Verifying Payment</p>
                                    <p className="text-[9px] text-foreground/30 max-w-[200px] uppercase tracking-widest font-bold">Profile update in progress. Please wait 5-10 minutes for manual verification.</p>
                                </div>
                            )}

                            {msg.text && (
                                <div className={`flex items-center justify-center gap-2 p-3 rounded-xl text-[10px] font-bold ${msg.type === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                    {msg.type === 'error' ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                                    {msg.text}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
