'use client';
import Script from 'next/script';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/auth';
import { Lock, Ticket, CreditCard, CheckCircle2, X, AlertCircle, Zap, Star, Crown } from 'lucide-react';

interface MonetizationOverlayProps {
    children: React.ReactNode;
    featureName: string;
}

const PLAN_METADATA: Record<string, any> = {
    basic: { icon: Zap, color: 'from-emerald-600 to-emerald-400', glow: 'shadow-emerald-500/20' },
    standard: { icon: Star, color: 'from-amber-600 to-amber-400', glow: 'shadow-amber-500/20' },
    premium: { icon: Crown, color: 'from-indigo-600 to-indigo-400', glow: 'shadow-indigo-500/20' },
};

export const MonetizationOverlay: React.FC<MonetizationOverlayProps> = ({ children, featureName }) => {
    const [status, setStatus] = useState<any>(null);
    const [plans, setPlans] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPlan, setSelectedPlan] = useState('standard');
    const [couponCode, setCouponCode] = useState('');
    const [applying, setApplying] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });
    const [showProofForm, setShowProofForm] = useState(false);
    const [appliedDiscount, setAppliedDiscount] = useState<number | null>(null);
    const [proof, setProof] = useState({ name: '', bank: '' });
    const [isPaystackReady, setIsPaystackReady] = useState(false);

    const fetchStatus = async () => {
        try {
            const [statusRes, plansRes] = await Promise.all([
                 apiFetch('/api/monetization/status'),
                 apiFetch('/api/monetization/plans')
            ]);

            if (statusRes.ok) {
                const data = await statusRes.json();
                setStatus(data);
            }
            if (plansRes.ok) {
                const pData = await plansRes.json();
                // Filter: Only show Basic, Standard, Premium
                const filtered = pData.filter((p: any) => ['basic', 'standard', 'premium'].includes(p.key));
                setPlans(filtered);
            }
        } catch (e) {
            console.error("Failed to fetch monetization data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchStatus(); }, []);

    const applyCoupon = async () => {
        if (!couponCode.trim()) return;
        setApplying(true);
        setMsg({ type: '', text: '' });
        try {
            const res = await apiFetch(`/api/monetization/apply-coupon?code=${encodeURIComponent(couponCode.trim())}`, { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                if (data.discount === 'free') {
                    setMsg({ type: 'success', text: '🎉 Access Granted! Reloading...' });
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    setAppliedDiscount(data.new_price);
                    setMsg({ type: 'success', text: data.message });
                    setShowProofForm(true);
                }
            } else {
                setMsg({ type: 'error', text: data.detail || 'Invalid or expired coupon code.' });
            }
        } catch {
            setMsg({ type: 'error', text: 'Server error. Please try again.' });
        } finally {
            setApplying(false);
        }
    };

    const handlePayNow = () => {
        if (!isPaystackReady) {
            setMsg({ type: 'error', text: 'Payment gateway still loading. Please wait a second.' });
            return;
        }
        
        const plan = plans.find(p => p.key === selectedPlan);
        if (!plan) {
            setMsg({ type: 'error', text: 'Please select a valid plan first.' });
            return;
        }

        const finalAmount = appliedDiscount ?? plan.price;
        const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

        console.log("ARKITEL: Initializing payment with PK starting:", publicKey?.substring(0, 10));

        if (!publicKey || publicKey === "undefined") {
            setMsg({ type: 'error', text: 'Payment configuration missing (NPPK). Ensure NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is set.' });
            return;
        }

        try {
            const ref = `ARK-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
            
            // Explicitly check for Paystack library after load
            const pPop = (window as any).PaystackPop;
            if (!pPop) {
                setMsg({ type: 'error', text: 'Paystack library not ready. Please wait 2 seconds and try again.' });
                return;
            }

            const handler = pPop.setup({
                key: publicKey,
                email: status?.email || `${(status?.username || 'user').replace(/\s+/g, '_')}@arkitel.app`,
                amount: Math.round(finalAmount * 100), // kobo
                currency: 'NGN',
                ref: ref,
                callback: function(response: any) {
                    setApplying(true);
                    setMsg({ type: 'success', text: 'Verifying payment... Do not close.' });
                    
                    apiFetch('/api/monetization/verify-paystack', {
                        method: 'POST',
                        body: JSON.stringify({
                            reference: response.reference,
                            plan_key: selectedPlan
                        })
                    }).then(res => {
                        if (res.ok) {
                            setMsg({ type: 'success', text: '🎉 Payment Verified! Welcome to Premium.' });
                            setTimeout(() => window.location.reload(), 2000);
                        } else {
                            setMsg({ type: 'error', text: 'Verification failed. Please contact admin.' });
                        }
                    }).catch(() => {
                        setMsg({ type: 'error', text: 'Server error during verification.' });
                    }).finally(() => {
                        setApplying(false);
                    });
                },
                onClose: function() {
                    setMsg({ type: 'error', text: 'Payment window closed.' });
                }
            });
            handler.open();
        } catch (err) {
            console.error("Paystack open error", err);
            setMsg({ type: 'error', text: 'Failed to open payment gateway. Refresh the page.' });
        }
    };

    const submitProof = async () => {
        if (!proof.name.trim() || !proof.bank.trim()) {
            setMsg({ type: 'error', text: 'Please fill in your name and bank name.' });
            return;
        }
        setApplying(true);
        try {
            const plan = plans.find(p => p.key === selectedPlan)!;
            const finalAmount = appliedDiscount ?? plan.price;
            const proofStr = `[${plan.name}] ${proof.name} | ${proof.bank} | ₦${finalAmount.toLocaleString()}`;
            const res = await apiFetch('/api/monetization/submit-proof', {
                method: 'POST',
                body: JSON.stringify({ proof_details: proofStr, amount: finalAmount })
            });
            if (res.ok) {
                setMsg({ type: 'success', text: 'Proof submitted! Admin will verify within minutes.' });
                setStatus({ ...status, has_proof: true });
                setShowProofForm(false);
            } else {
                const err = await res.json();
                setMsg({ type: 'error', text: err.detail || 'Submission failed.' });
            }
        } catch {
            setMsg({ type: 'error', text: 'Failed to submit. Please try again.' });
        } finally {
            setApplying(false);
        }
    };

    if (loading) return <>{children}</>;
    const isLocked = !status || status?.plan === 'free' || !status?.plan;

    return (
        <div className="relative w-full h-full min-h-[400px]">
            {children}
            {isLocked && (
                <>
                <Script 
                    src="https://js.paystack.co/v1/inline.js" 
                    strategy="lazyOnload"
                    onLoad={() => setIsPaystackReady(true)}
                />

                <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop - Minimalist Deep Dark */}
                    <div className="absolute inset-0 bg-[#0a0a0c]/95 backdrop-blur-md" />

                    {/* Centered Compact Card */}
                    <div className="relative w-full max-w-[400px] bg-[#111115] border border-white/5 rounded-[2.5rem] p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-500 overflow-hidden">
                        
                        {/* Header Area */}
                        <div className="text-center mb-6">
                            <div className="relative inline-flex mb-3">
                                <div className="absolute inset-0 bg-indigo-500/20 blur-2xl rounded-full" />
                                <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white shadow-lg">
                                    <Crown size={22} fill="currentColor" />
                                </div>
                            </div>
                            <h2 className="text-xl font-black text-white tracking-tight">
                                Unlock <span className="text-indigo-400">Mastery</span>
                            </h2>
                            <p className="text-foreground/30 text-[9px] font-bold uppercase tracking-[0.2em] mt-1.5 px-4">
                                {featureName} is available on paid plans
                            </p>
                        </div>

                        {status?.has_proof ? (
                            <div className="bg-emerald-500/5 border border-emerald-500/10 p-6 rounded-3xl text-center space-y-3">
                                <CheckCircle2 className="mx-auto text-emerald-400" size={28} />
                                <p className="font-bold text-xs text-emerald-400 uppercase tracking-widest">Verification Pending</p>
                                <p className="text-[10px] text-foreground/40 leading-relaxed max-w-[200px] mx-auto">
                                    Admin will unlock your account manually within a few minutes.
                                </p>
                            </div>
                        ) : showProofForm ? (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-1">
                                    <h3 className="font-black text-xs text-white/90 uppercase tracking-widest">Verify Payment</h3>
                                    <button onClick={() => setShowProofForm(false)} className="text-foreground/20 hover:text-white transition-colors">
                                        <X size={16} />
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    <input
                                        placeholder="Name on your Bank Account"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-foreground outline-none focus:border-indigo-500/40 placeholder:text-foreground/20 transition-all font-bold"
                                        value={proof.name}
                                        onChange={(e) => setProof({ ...proof, name: e.target.value })}
                                    />
                                    <input
                                        placeholder="Bank Name (Opay, GTB, etc)"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-foreground outline-none focus:border-indigo-500/40 placeholder:text-foreground/20 transition-all font-bold"
                                        value={proof.bank}
                                        onChange={(e) => setProof({ ...proof, bank: e.target.value })}
                                    />
                                </div>
                                <button
                                    onClick={submitProof}
                                    disabled={applying}
                                    className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-black py-3.5 rounded-xl transition-all text-xs shadow-lg shadow-indigo-500/20"
                                >
                                    {applying ? 'Processing...' : 'Submit Verification'}
                                </button>
                                <button onClick={handlePayNow} className="w-full text-foreground/20 text-[9px] font-black uppercase tracking-[0.2em] hover:text-indigo-400 transition-colors py-2">
                                    Back to payment
                                </button>
                            </div>
                        ) : (
                        <div className="space-y-5">
                            {/* Horizontal Plan Scroll/Tabs */}
                                <div className="grid grid-cols-3 gap-2">
                                    {plans.map((plan) => {
                                        const meta = PLAN_METADATA[plan.key] || { icon: Star, color: 'from-gray-500 to-gray-700' };
                                        const Icon = meta.icon;
                                        const isSelected = selectedPlan === plan.key;
                                        return (
                                            <button
                                                key={plan.key}
                                                type="button"
                                                onClick={() => setSelectedPlan(plan.key)}
                                                className={`relative flex flex-col items-center p-3 rounded-2xl border transition-all duration-300
                                                    ${isSelected
                                                        ? 'bg-indigo-500/10 border-indigo-500/40 scale-[1.05] shadow-xl'
                                                        : 'bg-white/[0.03] border-white/5 hover:bg-white/5 opacity-60'
                                                    }`}
                                            >
                                                <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center text-white mb-2 shadow-inner`}>
                                                    <Icon size={14} />
                                                </div>
                                                <div className="font-extrabold text-[10px] text-white/90 whitespace-nowrap">{plan.name}</div>
                                                <div className="text-[9px] font-bold text-foreground/40 mt-0.5">₦{plan.price.toLocaleString()}</div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Dynamic Perks - Centered and Boxed */}
                                {(() => {
                                    const plan = plans.find(p => p.key === selectedPlan);
                                    if (!plan) return null;
                                    const perks = typeof plan.perks === 'string' ? JSON.parse(plan.perks) : plan.perks;
                                    return (
                                        <div className="bg-[#18181b] border border-white/5 rounded-2xl p-4 overflow-hidden">
                                            <div className="flex items-center gap-2 mb-2 px-1">
                                                <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                                                <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40">Includes</span>
                                            </div>
                                            <div className="space-y-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                                                {perks.map((perk: string) => (
                                                    <div key={perk} className="flex items-center gap-2.5 text-[10px] font-bold text-foreground/60 leading-tight">
                                                        <div className="w-1 h-1 rounded-full bg-indigo-500/50 flex-shrink-0" />
                                                        {perk}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Action Buttons */}
                                <div className="space-y-3">
                                    <button
                                        onClick={handlePayNow}
                                        type="button"
                                        disabled={!isPaystackReady}
                                        className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white font-black py-4 rounded-2xl transition-all flex items-center justify-center gap-2.5 text-xs shadow-2xl shadow-indigo-500/20 active:scale-95"
                                    >
                                        <CreditCard size={14} />
                                        Upgrade to {plans.find(p => p.key === selectedPlan)?.name}
                                    </button>

                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="USE COUPON?"
                                            value={couponCode}
                                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                            className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-2.5 text-[10px] font-black outline-none focus:border-indigo-500/20 text-white placeholder:text-foreground/15 transition-all text-center tracking-widest"
                                        />
                                        <button
                                            onClick={applyCoupon}
                                            disabled={applying || !couponCode.trim()}
                                            className="px-4 rounded-xl bg-white/5 text-[9px] font-black uppercase text-foreground/30 hover:bg-indigo-500/20 hover:text-indigo-400 transition-all border border-white/5"
                                        >
                                            Apply
                                        </button>
                                    </div>
                                </div>

                                {msg.text && (
                                    <div className={`mt-2 flex items-center justify-center gap-2 py-2 px-4 rounded-full text-[9px] font-bold border transition-all animate-in slide-in-from-top-1
                                        ${msg.type === 'error' ? 'bg-red-500/5 text-red-400 border-red-500/10' : 'bg-emerald-500/5 text-emerald-400 border-emerald-500/10'}`}>
                                        <AlertCircle size={10} />
                                        {msg.text}
                                    </div>
                                )}
                            </div>
                        )}
                        
                        {/* Status Label */}
                        {!isPaystackReady && !showProofForm && !status?.has_proof && (
                             <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-background/50 backdrop-blur-xl px-2 py-1 rounded-full border border-white/5 animate-pulse">
                                 <div className="w-1 h-1 rounded-full bg-amber-400" />
                                 <span className="text-[7px] font-black text-amber-400 uppercase tracking-widest">Gateway Loading</span>
                             </div>
                        )}
                    </div>
                </div>
                </>
            )}
        </div>
    );
};
