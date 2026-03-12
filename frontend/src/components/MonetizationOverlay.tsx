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
                <div className="absolute inset-0 z-50 flex items-center justify-center p-6 sm:p-12 overflow-hidden rounded-[inherit]">
                    {/* Glass Backdrop */}
                    <div className="absolute inset-0 bg-background/40 backdrop-blur-2xl" />
                    
                    {/* Floating Glows */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px]" />
                    <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] bg-red-500/5 rounded-full blur-[100px]" />

                    <div className="relative w-full max-w-xl bg-card/60 border border-white/10 p-8 sm:p-12 rounded-[40px] shadow-2xl flex flex-col items-center text-center space-y-8 animate-in zoom-in-95 duration-500">
                        <div className="relative">
                            <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-20 animate-pulse" />
                            <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-2xl">
                                <Lock size={40} />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h2 className="text-3xl font-extrabold tracking-tight">
                                Unlock <span className="bg-gradient-to-r from-indigo-400 to-indigo-300 bg-clip-text text-transparent">Premium {featureName}</span>
                            </h2>
                            <p className="text-foreground/50 text-sm font-medium leading-relaxed max-w-sm px-4">
                                This feature belongs to the Arkitel Underground Vault. Upgrade to Premium for life-time access, 3x account slots, and high-capacity scraping.
                            </p>
                        </div>

                        <div className="w-full space-y-4">
                            {!status?.has_proof ? (
                                <>
                                    {!showProofForm ? (
                                        <>
                                            <div className="bg-white/5 border border-white/5 p-6 rounded-[24px] space-y-4">
                                                <div className="flex items-center justify-between text-sm font-bold">
                                                    <span className="text-foreground/40 uppercase tracking-widest text-[10px]">Access Fee</span>
                                                    <span className="text-xl tabular-nums">#5,000.00</span>
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        window.open('https://paystack.com/pay/arkitel-premium', '_blank'); // PLACEHOLDER
                                                        setShowProofForm(true);
                                                    }}
                                                    className="w-full bg-foreground text-background font-bold py-4 rounded-2xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
                                                >
                                                    <CreditCard size={18} /> Pay with Paystack
                                                </button>
                                                <p className="text-[10px] text-foreground/30 font-medium">Safe & Secure payment via Paystack. Automated unlock available.</p>
                                            </div>

                                            <div className="flex items-center gap-4 py-2">
                                                <div className="h-px flex-1 bg-white/5" />
                                                <span className="text-[10px] font-bold text-foreground/20 uppercase tracking-widest">OR USE COUPON</span>
                                                <div className="h-px flex-1 bg-white/5" />
                                            </div>

                                            <div className="flex gap-2">
                                                <div className="relative flex-1">
                                                    <Ticket className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/30" size={18} />
                                                    <input 
                                                        type="text" 
                                                        placeholder="Enter Code..."
                                                        value={couponCode}
                                                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                                        className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-sm font-bold focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                                    />
                                                </div>
                                                <button 
                                                    onClick={applyCoupon}
                                                    disabled={applying || !couponCode}
                                                    className="px-6 rounded-2xl bg-indigo-500/10 text-indigo-400 font-bold hover:bg-indigo-500 hover:text-white transition-all disabled:opacity-30"
                                                >
                                                    {applying ? '...' : 'Apply'}
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="bg-white/5 border border-white/10 p-6 rounded-[32px] space-y-5 animate-in slide-in-from-bottom-4 duration-500">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-bold text-sm">Submission Form</h3>
                                                <button onClick={() => setShowProofForm(false)} className="text-foreground/40 hover:text-foreground"><X size={16} /></button>
                                            </div>
                                            <div className="space-y-3">
                                                <input 
                                                    placeholder="Account Name Used"
                                                    className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm"
                                                    onChange={(e) => setProof({...proof, name: e.target.value})}
                                                />
                                                <input 
                                                    placeholder="Bank Name"
                                                    className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-3 text-sm"
                                                    onChange={(e) => setProof({...proof, bank: e.target.value})}
                                                />
                                            </div>
                                            <button 
                                                onClick={submitProof}
                                                className="w-full bg-indigo-500 text-white font-bold py-3 rounded-xl hover:bg-indigo-400 transition-all"
                                            >
                                                Submit Proof for Review
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="bg-emerald-500/5 border border-emerald-500/10 p-8 rounded-[32px] flex flex-col items-center space-y-4">
                                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                        <CheckCircle2 size={24} />
                                    </div>
                                    <p className="font-bold text-sm">Payment Proof Submitted</p>
                                    <p className="text-[10px] text-foreground/40 max-w-xs uppercase tracking-widest font-bold">The Admin is currently verifying your profile. This usually takes 5-15 minutes.</p>
                                </div>
                            )}

                            {msg.text && (
                                <div className={`flex items-center gap-2 p-3 rounded-xl text-[11px] font-bold ${msg.type === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                    {msg.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
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
