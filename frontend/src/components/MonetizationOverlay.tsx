'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/auth';
import { Lock, Ticket, CreditCard, CheckCircle2, X, AlertCircle, Zap, Star, Crown } from 'lucide-react';

interface MonetizationOverlayProps {
    children: React.ReactNode;
    featureName: string;
}

const PLANS = [
    {
        key: 'basic',
        name: 'Basic',
        price: 2000,
        icon: Zap,
        color: 'from-emerald-600 to-emerald-400',
        glow: 'shadow-emerald-500/20',
        badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
        perks: ['50 campaigns / day', '1 Telegram account', '50 leads per search', '10 keyword searches / day'],
        paystackUrl: 'https://paystack.com/pay/arkitel-basic',
    },
    {
        key: 'standard',
        name: 'Standard',
        price: 3500,
        icon: Star,
        color: 'from-amber-600 to-amber-400',
        glow: 'shadow-amber-500/20',
        badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
        perks: ['150 campaigns / day', '2 Telegram accounts', '150 leads per search', '15 keyword searches / day'],
        paystackUrl: 'https://paystack.com/pay/arkitel-standard',
        popular: true,
    },
    {
        key: 'premium',
        name: 'Premium',
        price: 5000,
        icon: Crown,
        color: 'from-indigo-600 to-indigo-400',
        glow: 'shadow-indigo-500/20',
        badge: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
        perks: ['300 campaigns / day', '3 Telegram accounts', '350 leads per search', '30 keyword searches / day'],
        paystackUrl: 'https://paystack.com/pay/arkitel-premium',
    },
];

export const MonetizationOverlay: React.FC<MonetizationOverlayProps> = ({ children, featureName }) => {
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [selectedPlan, setSelectedPlan] = useState('standard');
    const [couponCode, setCouponCode] = useState('');
    const [applying, setApplying] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });
    const [showProofForm, setShowProofForm] = useState(false);
    const [appliedDiscount, setAppliedDiscount] = useState<number | null>(null);
    const [proof, setProof] = useState({ name: '', bank: '' });

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
        const plan = PLANS.find(p => p.key === selectedPlan)!;
        window.open(plan.paystackUrl, '_blank');
        setShowProofForm(true);
        setMsg({ type: '', text: '' });
    };

    const submitProof = async () => {
        if (!proof.name.trim() || !proof.bank.trim()) {
            setMsg({ type: 'error', text: 'Please fill in your name and bank name.' });
            return;
        }
        setApplying(true);
        try {
            const plan = PLANS.find(p => p.key === selectedPlan)!;
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
                <div className="absolute inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto rounded-[inherit]">
                    {/* Dark Solid Backdrop for Mobile, Glass for Desktop */}
                    <div className="absolute inset-0 bg-background/95 lg:bg-background/80 lg:backdrop-blur-xl" />
                    <div className="hidden lg:block absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/8 rounded-full blur-[120px] pointer-events-none" />

                    <div className="relative w-full max-w-[480px] my-4 animate-in zoom-in-95 duration-400">

                        {/* Header */}
                        <div className="text-center mb-5">
                            <div className="relative inline-flex mb-3">
                                <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-25 animate-pulse rounded-full" />
                                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xl shadow-indigo-500/30">
                                    <Lock size={24} />
                                </div>
                            </div>
                            <h2 className="text-xl font-black tracking-tight text-white leading-none">
                                Arkitel <span className="text-indigo-400">Premium Vault</span>
                            </h2>
                            <p className="text-foreground/35 text-[10px] font-bold uppercase tracking-[0.2em] mt-1">
                                {featureName} — Paid Plans Only
                            </p>
                        </div>

                        {status?.has_proof ? (
                            /* === PENDING VERIFICATION STATE === */
                            <div className="bg-emerald-500/5 border border-emerald-500/15 p-6 rounded-3xl flex flex-col items-center space-y-3 text-center">
                                <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                                    <CheckCircle2 size={20} />
                                </div>
                                <p className="font-bold text-sm text-emerald-400">Payment Proof Submitted</p>
                                <p className="text-[10px] text-foreground/30 max-w-[220px] uppercase tracking-wider leading-relaxed font-bold">
                                    Your payment is being verified. Access will be granted shortly.
                                </p>
                            </div>
                        ) : showProofForm ? (
                            /* === PROOF SUBMISSION FORM === */
                            <div className="bg-card/80 border border-white/10 p-6 rounded-3xl space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="font-bold text-sm text-white">Confirm Your Payment</h3>
                                    <button onClick={() => setShowProofForm(false)} className="text-foreground/30 hover:text-foreground transition-colors">
                                        <X size={16} />
                                    </button>
                                </div>
                                <p className="text-[10px] text-foreground/30 leading-relaxed">
                                    After paying on Paystack, enter the name and bank you used so the admin can verify your payment.
                                </p>
                                <div className="space-y-2.5">
                                    <input
                                        placeholder="Full Name Used on Payment"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-foreground outline-none focus:border-indigo-500/60 placeholder:text-foreground/25 transition-colors"
                                        value={proof.name}
                                        onChange={(e) => setProof({ ...proof, name: e.target.value })}
                                    />
                                    <input
                                        placeholder="Your Bank Name (e.g. GTBank, Opay)"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-foreground outline-none focus:border-indigo-500/60 placeholder:text-foreground/25 transition-colors"
                                        value={proof.bank}
                                        onChange={(e) => setProof({ ...proof, bank: e.target.value })}
                                    />
                                </div>
                                {appliedDiscount !== null && (
                                    <div className="text-center text-xs font-bold text-emerald-400 bg-emerald-500/10 py-2 rounded-xl border border-emerald-500/20">
                                        ✅ Coupon Applied — Amount: ₦{appliedDiscount.toLocaleString()}
                                    </div>
                                )}
                                <button
                                    onClick={submitProof}
                                    disabled={applying}
                                    className="w-full bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all text-sm shadow-lg shadow-indigo-500/20 active:scale-95"
                                >
                                    {applying ? 'Submitting...' : 'Submit Proof of Payment'}
                                </button>
                                {/* Pay again button */}
                                <button
                                    onClick={handlePayNow}
                                    className="w-full text-foreground/30 text-[10px] font-bold hover:text-indigo-400 transition-colors py-1"
                                >
                                    Haven't paid yet? Click to Pay
                                </button>
                            </div>
                        ) : (
                            /* === PLAN SELECTION + COUPON === */
                            <div className="space-y-3">
                                {/* Plan Cards */}
                                <div className="grid grid-cols-3 gap-2">
                                    {PLANS.map((plan) => {
                                        const Icon = plan.icon;
                                        const isSelected = selectedPlan === plan.key;
                                        return (
                                            <button
                                                key={plan.key}
                                                onClick={() => setSelectedPlan(plan.key)}
                                                className={`relative flex flex-col items-center p-3 rounded-2xl border transition-all duration-200 text-left
                                                    ${isSelected
                                                        ? 'bg-white/8 border-white/20 scale-[1.03] shadow-xl'
                                                        : 'bg-white/3 border-white/6 hover:border-white/12 hover:bg-white/5'
                                                    }`}
                                            >
                                                {plan.popular && (
                                                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-black uppercase tracking-widest bg-amber-500 text-black px-2 py-0.5 rounded-full whitespace-nowrap">
                                                        Popular
                                                    </div>
                                                )}
                                                <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center text-white mb-2 shadow-lg ${plan.glow}`}>
                                                    <Icon size={14} />
                                                </div>
                                                <div className="font-black text-[11px] text-white">{plan.name}</div>
                                                <div className="text-[10px] font-bold text-foreground/40 mt-0.5">₦{plan.price.toLocaleString()}</div>
                                                {isSelected && (
                                                    <div className="absolute bottom-2 right-2">
                                                        <CheckCircle2 size={10} className="text-white/60" />
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Selected Plan Perks */}
                                {(() => {
                                    const plan = PLANS.find(p => p.key === selectedPlan)!;
                                    const Icon = plan.icon;
                                    return (
                                        <div className="bg-white/3 border border-white/6 rounded-2xl p-3 space-y-1.5">
                                            <div className="flex items-center gap-1.5 mb-2">
                                                <Icon size={11} className="text-white/40" />
                                                <span className="text-[9px] font-black uppercase tracking-widest text-foreground/30">{plan.name} Includes</span>
                                            </div>
                                            {plan.perks.map((perk) => (
                                                <div key={perk} className="flex items-center gap-2 text-[10px] text-foreground/50">
                                                    <div className="w-1 h-1 rounded-full bg-foreground/30 flex-shrink-0" />
                                                    {perk}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}

                                {/* Pay Button */}
                                <button
                                    onClick={handlePayNow}
                                    className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-indigo-500/25 active:scale-95"
                                >
                                    <CreditCard size={15} />
                                    Pay ₦{PLANS.find(p => p.key === selectedPlan)?.price.toLocaleString()} via Paystack
                                </button>

                                {/* Divider */}
                                <div className="flex items-center gap-3">
                                    <div className="h-px flex-1 bg-white/5" />
                                    <span className="text-[9px] font-bold text-foreground/20 uppercase tracking-widest">Have a coupon?</span>
                                    <div className="h-px flex-1 bg-white/5" />
                                </div>

                                {/* Coupon */}
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/25" size={13} />
                                        <input
                                            type="text"
                                            placeholder="Enter coupon code..."
                                            value={couponCode}
                                            onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setMsg({ type: '', text: '' }); }}
                                            onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
                                            className="w-full bg-white/5 border border-white/8 rounded-xl pl-9 pr-3 py-2.5 text-[11px] font-bold outline-none focus:border-indigo-500/50 placeholder:text-foreground/20 text-white transition-colors"
                                        />
                                    </div>
                                    <button
                                        onClick={applyCoupon}
                                        disabled={applying || !couponCode.trim()}
                                        className="px-4 rounded-xl bg-white/5 border border-white/8 text-foreground/50 text-[11px] font-bold hover:bg-indigo-500 hover:text-white hover:border-transparent transition-all disabled:opacity-30 active:scale-95 whitespace-nowrap"
                                    >
                                        {applying ? '...' : 'Apply'}
                                    </button>
                                </div>

                                {/* Feedback Message */}
                                {msg.text && (
                                    <div className={`flex items-center gap-2 p-3 rounded-xl text-[10px] font-bold ${msg.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/15' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'}`}>
                                        {msg.type === 'error' ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                                        {msg.text}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Footer Message below proof form too */}
                        {msg.text && showProofForm && (
                            <div className={`mt-3 flex items-center gap-2 p-3 rounded-xl text-[10px] font-bold ${msg.type === 'error' ? 'bg-red-500/10 text-red-400 border border-red-500/15' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'}`}>
                                {msg.type === 'error' ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                                {msg.text}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
