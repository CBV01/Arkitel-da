'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/auth';
import {
    Users,
    MessageSquare,
    Activity,
    Settings,
    Shield,
    Pause,
    Play,
    Trash2,
    Database,
    Search,
    X,
    Megaphone,
    Lock as MasterLock,
    CreditCard,
    Ticket,
    CheckCircle2,
    AlertCircle,
    FileText,
    Copy,
    Eye,
    ExternalLink
} from 'lucide-react';
import { Preloader } from '@/components/Preloader';

export default function AdminDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [plans, setPlans] = useState<any[]>([]);
    const [loadingPlans, setLoadingPlans] = useState(false);
    const [passkey, setPasskey] = useState('');
    const [broadcastMsg, setBroadcastMsg] = useState('');
    const [broadcastType, setBroadcastType] = useState('info');
    const [sendingBroadcast, setSendingBroadcast] = useState(false);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [globalTemplates, setGlobalTemplates] = useState<any[]>([]);
    const [keywordLogs, setKeywordLogs] = useState<any[]>([]);

    const fetchKeywordLogs = async () => {
        try {
            const res = await apiFetch('/api/admin/keyword-logs');
            if (res.ok) {
                const data = await res.json();
                setKeywordLogs(data.logs || []);
            }
        } catch (e) {
            console.error("Keyword log fetch failed");
        }
    };

    const fetchGlobalTemplates = async () => {
        try {
            const res = await apiFetch('/api/admin/templates');
            if (res.ok) {
                const data = await res.json();
                setGlobalTemplates(data.templates || []);
            }
        } catch (e) {
            console.error("Failed to fetch global templates");
        }
    };
    const [userDetails, setUserDetails] = useState<any>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [coupons, setCoupons] = useState<any[]>([]);
    const [monetizationUsers, setMonetizationUsers] = useState<any[]>([]);
    const [loadingMonetization, setLoadingMonetization] = useState(false);
    const [newCoupon, setNewCoupon] = useState({ code: '', price: 5000, max_daily_campaigns: '', max_daily_keywords: '', scrape_limit: '' });
    const [editingPlan, setEditingPlan] = useState<any>(null);
    const [viewingTemplate, setViewingTemplate] = useState<any>(null);

    const fetchAdminData = async () => {
        try {
            const [statsRes, usersRes] = await Promise.all([
                apiFetch('/api/admin/stats'),
                apiFetch('/api/admin/users')
            ]);

            if (statsRes.ok && usersRes.ok) {
                const statsData = await statsRes.json();
                const usersData = await usersRes.json();
                setStats(statsData);
                setUsers(usersData.users || []);
            } else {
                const statsStatus = statsRes.status;
                const usersStatus = usersRes.status;
                let statsErr = '';
                let usersErr = '';
                try { statsErr = await statsRes.text(); } catch (e) { }
                try { usersErr = await usersRes.text(); } catch (e) { }

                console.error("Admin API Error Details:", {
                    stats: { status: statsStatus, body: statsErr },
                    users: { status: usersStatus, body: usersErr }
                });
                setErrorMsg(`Admin API Error! Stats: ${statsStatus} | Users: ${usersStatus}`);
            }
        } catch (err: any) {
            console.error("Critical fetch error in admin dashboard:", err);
            setErrorMsg(`Connection Error: ${err.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    const fetchMonetizationData = async () => {
        setLoadingMonetization(true);
        try {
            // Fetch coupons and users independently so one failure doesn't block the other
            const couponsRes = await apiFetch('/api/admin/monetization/coupons');
            if (couponsRes.ok) {
                const cData = await couponsRes.json();
                setCoupons(cData.coupons || []);
            } else {
                const errText = await couponsRes.text();
                console.error(`Coupons fetch failed [${couponsRes.status}]:`, errText);
            }

            const monoUsersRes = await apiFetch('/api/admin/monetization/users');
            if (monoUsersRes.ok) {
                const uData = await monoUsersRes.json();
                setMonetizationUsers(uData.users || []);
            } else {
                const errText = await monoUsersRes.text();
                console.error(`Monetization users fetch failed [${monoUsersRes.status}]:`, errText);
                setErrorMsg(`Failed to load monetization users: ${monoUsersRes.status} - ${errText}`);
            }
        } catch (err: any) {
            console.error('Monetization fetch error:', err);
            setErrorMsg(`Monetization load error: ${err.message}`);
        } finally {
            setLoadingMonetization(false);
        }
    };

    const fetchPlans = async () => {
        setLoadingPlans(true);
        try {
            const res = await apiFetch('/api/admin/plans');
            if (res.ok) {
                const data = await res.json();
                setPlans(data);
            }
        } catch (err) {
            console.error("Failed to fetch plans", err);
        } finally {
            setLoadingPlans(false);
        }
    };

    useEffect(() => {
        fetchAdminData();
    }, []);

    useEffect(() => {
        if (activeTab === 'monetization') {
            fetchMonetizationData();
        } else if (activeTab === 'packages') {
            fetchPlans();
        } else if (activeTab === 'templates') { // Added condition for templates tab
            fetchGlobalTemplates();
        } else if (activeTab === 'search-logs') {
            fetchKeywordLogs();
        }
    }, [activeTab]);

    const updatePasskey = async () => {
        if (!passkey) return;
        const res = await apiFetch(`/api/admin/settings?key=global_passkey&value=${passkey}`, {
            method: 'POST'
        });
        if (res.ok) {
            setSuccessMsg("Passkey updated successfully");
            setTimeout(() => setSuccessMsg(''), 5000);
            setPasskey('');
        }
    };

    const toggleUserStatus = async (userId: string) => {
        const res = await apiFetch(`/api/admin/users/${userId}/toggle-status`, { method: 'POST' });
        if (res.ok) {
            // Update local state
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_active: !u.is_active } : u));
            if (stats?.per_user) {
                setStats({
                    ...stats,
                    per_user: stats.per_user.map((u: any) => u.id === userId ? { ...u, is_active: !u.is_active } : u)
                });
            }
        }
    };

    const fetchUserDetails = async (user: any) => {
        setSelectedUser(user);
        setLoadingDetails(true);
        try {
            const res = await apiFetch(`/api/admin/users/${user.id}/details`);
            if (res.ok) {
                const data = await res.json();
                setUserDetails(data);
            }
        } catch (err) {
            console.error("Failed to fetch user details", err);
        } finally {
            setLoadingDetails(false);
        }
    };

    const deleteUser = async (userId: string) => {
        if (!confirm("CRITICAL WARNING: Are you sure you want to completely delete this user and ALL of their connected accounts, campaigns, and scraped leads? This cannot be undone.")) return;
        try {
            const res = await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
            if (res.ok) {
                setSuccessMsg("User and all data permanently deleted.");
                setTimeout(() => setSuccessMsg(''), 5000);
                fetchAdminData();
            } else {
                const data = await res.json();
                setErrorMsg(data.detail || "Failed to delete user");
                setTimeout(() => setErrorMsg(''), 5000);
            }
        } catch (e: any) {
             setErrorMsg(e.message || "Failed to delete user");
             setTimeout(() => setErrorMsg(''), 5000);
        }
    };

    if (loading) {
        return <Preloader message="Synchronizing System Control Matrix..." />;
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {errorMsg && (
                <div className="fixed top-8 right-8 z-[100] bg-red-500/10 border border-red-500/20 text-red-500 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3">
                    <X className="shrink-0" size={20} />
                    <span className="font-bold text-sm">{errorMsg}</span>
                    <button onClick={() => setErrorMsg('')} className="ml-4 opacity-50 hover:opacity-100"><X size={16} /></button>
                </div>
            )}
            {successMsg && (
                <div className="fixed top-8 right-8 z-[100] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3">
                    <Activity className="shrink-0" size={20} />
                    <span className="font-bold text-sm">{successMsg}</span>
                </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 mb-4 animate-in fade-in slide-in-from-left duration-700">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-red-500 uppercase tracking-[0.2em]">Security Control Center</span>
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-red-500 via-orange-400 to-indigo-500 bg-clip-text text-transparent">
                        Platform <span className="text-foreground">Authority</span>
                    </h1>
                    <p className="text-foreground/50 text-sm mt-2 font-medium">Global management of multi-tenant infrastructure and secure gateways</p>
                </div>

                <div className="flex bg-white/[0.03] backdrop-blur-3xl p-1.5 rounded-2xl border border-white/5 overflow-x-auto">
                    {['overview', 'users', 'packages', 'monetization', 'templates', 'search-logs', 'settings', 'maintenance'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-8 py-2.5 rounded-xl text-sm font-bold capitalize transition-all duration-300 shrink-0 ${activeTab === tab
                                ? 'bg-red-500 text-white shadow-xl shadow-red-500/20 active:scale-95'
                                : 'text-foreground/40 hover:text-foreground hover:bg-white/5'
                                }`}
                        >
                            {tab.replace('-', ' ')}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === 'overview' && (
                <div className="space-y-8">
                    {/* Global Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                            { label: 'Total Users', value: stats?.global?.users ?? '...', icon: Users, color: 'text-blue-400' },
                            { label: 'System Revenue', value: stats?.global?.revenue ? `#${stats.global.revenue}` : '#0', icon: CreditCard, color: 'text-emerald-400' },
                            { label: 'Pending Approvals', value: stats?.global?.pending ?? '0', icon: AlertCircle, color: 'text-orange-400' },
                            { label: 'Total Leads', value: stats?.global?.leads ?? '...', icon: Database, color: 'text-indigo-400' },
                        ].map((stat, i) => (
                            <div key={i} className="bg-white/5 backdrop-blur-xl border border-white/5 p-6 rounded-3xl relative overflow-hidden group">
                                <div className={`p-3 rounded-2xl bg-white/5 w-fit mb-4 ${stat.color}`}>
                                    <stat.icon size={24} />
                                </div>
                                <div className="text-3xl font-bold text-foreground">
                                    {stat.value}
                                </div>
                                <div className="text-sm text-foreground/40 font-medium mt-1 uppercase tracking-wider">{stat.label}</div>
                                <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
                                    <stat.icon size={100} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Per-User Activity Table */}
                    <div className="bg-white/5 border border-white/5 rounded-3xl overflow-hidden">
                        <div className="p-6 border-b border-white/5 flex items-center justify-between">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Activity size={20} className="text-indigo-400" />
                                User Activity Analysis
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="text-[10px] uppercase tracking-[0.2em] text-foreground/30 border-b border-white/5">
                                    <tr>
                                        <th className="px-6 py-4 font-bold">Username</th>
                                        <th className="px-6 py-4 font-bold">Accounts</th>
                                        <th className="px-6 py-4 font-bold">Campaigns</th>
                                        <th className="px-6 py-4 font-bold">Leads Scraped</th>
                                        <th className="px-6 py-4 font-bold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {stats?.per_user?.map((user: any, i: number) => (
                                        <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="font-semibold text-foreground group-hover:text-indigo-400 transition-colors">{user.username}</div>
                                            </td>
                                            <td className="px-6 py-4 font-mono text-foreground/60">{user.accounts}</td>
                                            <td className="px-6 py-4 font-mono text-foreground/60">{user.tasks}</td>
                                            <td className="px-6 py-4 font-mono text-foreground/60">{user.leads}</td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => fetchUserDetails(user)}
                                                        className="p-2 rounded-lg bg-white/5 text-foreground/40 hover:text-indigo-400 hover:bg-indigo-400/10 transition-all" title="View Details"
                                                    >
                                                        <Search size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => toggleUserStatus(user.id)}
                                                        className={`p-2 rounded-lg bg-white/5 transition-all ${user.is_active ? 'text-orange-400 hover:bg-orange-400/10' : 'text-green-400 hover:bg-green-400/10'}`}
                                                        title={user.is_active ? 'Suspend User' : 'Activate User'}
                                                    >
                                                        {user.is_active ? <Pause size={16} /> : <Play size={16} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'users' && (
                <div className="bg-white/5 border border-white/5 rounded-3xl overflow-hidden">
                    <div className="p-6 border-b border-white/5">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Users size={20} className="text-blue-400" />
                            Manage Users
                        </h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="text-[10px] uppercase tracking-[0.2em] text-foreground/30 border-b border-white/5">
                                <tr>
                                    <th className="px-6 py-4 font-bold">Username</th>
                                    <th className="px-6 py-4 font-bold">Role</th>
                                    <th className="px-6 py-4 font-bold">Status</th>
                                    <th className="px-6 py-4 font-bold">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {users.map((u, i) => (
                                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="font-semibold text-foreground">{u.username}</div>
                                            <div className="text-[10px] text-foreground/30 font-mono">{u.id}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${u.role === 'admin' ? 'bg-red-500/20 text-red-500' : 'bg-blue-500/20 text-blue-500'
                                                }`}>
                                                {u.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`flex items-center gap-2 text-xs font-semibold ${u.is_active ? 'text-green-500' : 'text-red-500'}`}>
                                                <div className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
                                                {u.is_active ? 'Active' : 'Suspended'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => fetchUserDetails(u)}
                                                    className="p-2 rounded-lg bg-white/5 text-foreground/40 hover:text-indigo-400 hover:bg-indigo-400/10 transition-all"
                                                >
                                                    <Search size={16} />
                                                </button>
                                                <button
                                                    onClick={() => toggleUserStatus(u.id)}
                                                    className={`p-2 rounded-lg bg-green-500/5 hover:bg-green-500/10 transition-all ${u.is_active ? 'text-orange-400 hover:text-orange-500 hover:bg-orange-500/10' : 'text-green-500 hover:bg-green-500/10'}`}
                                                >
                                                    {u.is_active ? <Pause size={16} /> : <Play size={16} />}
                                                </button>
                                                <button
                                                    onClick={() => deleteUser(u.id)}
                                                    className="p-2 rounded-lg bg-red-500/5 hover:bg-red-500/10 text-red-500/50 hover:text-red-500 transition-all"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'packages' && (
                <div className="space-y-8">
                    <div className="bg-white/5 border border-white/5 rounded-3xl p-8">
                         <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400">
                                    <Database size={24} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold">Package Configurations</h2>
                                    <p className="text-sm text-foreground/40 mt-0.5">Define world settings for automated plans</p>
                                </div>
                            </div>
                         </div>

                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {plans.map((plan) => (
                                <div key={plan.key} className="bg-white/5 border border-white/5 p-6 rounded-3xl relative group overflow-hidden">
                                     <div className="flex items-center justify-between mb-6">
                                        <div>
                                            <h3 className="text-lg font-bold text-foreground capitalize">{plan.name}</h3>
                                            <div className="text-2xl font-black text-indigo-400">#{plan.price}</div>
                                        </div>
                                        <button
                                            onClick={() => setEditingPlan(plan)}
                                            className="p-3 rounded-xl bg-white/5 text-foreground/40 hover:text-white hover:bg-indigo-500 transition-all shadow-lg"
                                        >
                                            <Settings size={20} />
                                        </button>
                                     </div>

                                     <div className="space-y-3">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-foreground/40 font-bold uppercase tracking-widest">Daily Campaigns</span>
                                            <span className="font-mono text-white">{plan.max_daily_campaigns > 9999 ? 'Unlimited' : plan.max_daily_campaigns}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-foreground/40 font-bold uppercase tracking-widest">Telegram Accounts</span>
                                            <span className="font-mono text-white">{plan.max_accounts}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-foreground/40 font-bold uppercase tracking-widest">Scrape Limit</span>
                                            <span className="font-mono text-white">{plan.scrape_limit}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-foreground/40 font-bold uppercase tracking-widest">Template Limit</span>
                                            <span className="font-mono text-indigo-400 font-bold">{plan.max_templates}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-foreground/40 font-bold uppercase tracking-widest">Premium Status</span>
                                            <span className={`font-mono ${plan.has_premium_access ? 'text-emerald-400' : 'text-foreground/20'}`}>
                                                {plan.has_premium_access ? 'YES' : 'NO'}
                                            </span>
                                        </div>
                                     </div>

                                     <div className="mt-6 pt-6 border-t border-white/5">
                                         <div className="text-[10px] font-bold text-foreground/30 uppercase tracking-[0.2em] mb-3">Stored Perks</div>
                                         <div className="flex flex-wrap gap-2">
                                            {(JSON.parse(plan.perks || '[]')).map((perk: string, idx: number) => (
                                                <span key={idx} className="px-2 py-1 rounded-md bg-white/5 text-[10px] text-foreground/60 border border-white/5">
                                                    {perk}
                                                </span>
                                            ))}
                                         </div>
                                     </div>
                                </div>
                            ))}
                         </div>
                    </div>

                    {/* Edit Plan Modal Overlay */}
                    {editingPlan && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                            <div className="bg-[#0a0a0b] border border-white/10 rounded-[32px] w-full max-w-xl shadow-2xl relative animate-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto custom-scrollbar p-8">
                                <div className="flex justify-between items-center mb-8">
                                    <div className="flex items-center gap-3">
                                        <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400">
                                            <Settings size={24} />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-xl">Edit {editingPlan.name} Plan</h3>
                                            <p className="text-xs text-foreground/40 font-medium">Update database-level constraints</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setEditingPlan(null)} className="text-foreground/20 hover:text-foreground"><X size={24} /></button>
                                </div>

                                <div className="space-y-6">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Display Name</label>
                                            <input 
                                                type="text" 
                                                value={editingPlan.name}
                                                onChange={(e) => setEditingPlan({...editingPlan, name: e.target.value})}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Price (#)</label>
                                            <input 
                                                type="number" 
                                                value={editingPlan.price}
                                                onChange={(e) => setEditingPlan({...editingPlan, price: parseInt(e.target.value)})}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Daily Campaigns</label>
                                            <input 
                                                type="number" 
                                                value={editingPlan.max_daily_campaigns}
                                                onChange={(e) => setEditingPlan({...editingPlan, max_daily_campaigns: parseInt(e.target.value)})}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Telegram Accounts</label>
                                            <input 
                                                type="number" 
                                                value={editingPlan.max_accounts}
                                                onChange={(e) => setEditingPlan({...editingPlan, max_accounts: parseInt(e.target.value)})}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Scrape Limit</label>
                                            <input 
                                                type="number" 
                                                value={editingPlan.scrape_limit}
                                                onChange={(e) => setEditingPlan({...editingPlan, scrape_limit: parseInt(e.target.value)})}
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:border-indigo-500 transition-all" 
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Template Limit</label>
                                            <input 
                                                type="number" 
                                                value={editingPlan.max_templates}
                                                onChange={(e) => setEditingPlan({...editingPlan, max_templates: parseInt(e.target.value)})}
                                                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:border-indigo-500 transition-all" 
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Keyword Searches</label>
                                            <input 
                                                type="number" 
                                                value={editingPlan.max_daily_keywords}
                                                onChange={(e) => setEditingPlan({...editingPlan, max_daily_keywords: parseInt(e.target.value)})}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 py-4 px-6 rounded-2xl bg-white/5 border border-white/10">
                                        <input 
                                            type="checkbox" 
                                            checked={editingPlan.has_premium_access === 1 || editingPlan.has_premium_access === true}
                                            onChange={(e) => setEditingPlan({...editingPlan, has_premium_access: e.target.checked})}
                                            className="w-5 h-5 accent-indigo-500"
                                            id="hasPremium"
                                        />
                                        <label htmlFor="hasPremium" className="text-sm font-bold text-foreground/60 cursor-pointer">Grant Premium Access (Scraper, Leads)</label>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-foreground/30 uppercase tracking-widest">Perks (Comma Separated)</label>
                                        <textarea 
                                            value={(JSON.parse(editingPlan.perks || '[]')).join(', ')}
                                            onChange={(e) => {
                                                const perks = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                                setEditingPlan({...editingPlan, perks: JSON.stringify(perks)});
                                            }}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none h-24"
                                        />
                                    </div>

                                    <button
                                        onClick={async () => {
                                            try {
                                                const perksArray = Array.isArray(editingPlan.perks) 
                                                    ? editingPlan.perks 
                                                    : JSON.parse(editingPlan.perks || '[]');

                                                const payload = {
                                                    key: editingPlan.key,
                                                    name: editingPlan.name,
                                                    price: parseInt(editingPlan.price),
                                                    max_daily_campaigns: parseInt(editingPlan.max_daily_campaigns),
                                                    max_accounts: parseInt(editingPlan.max_accounts),
                                                    max_daily_keywords: parseInt(editingPlan.max_daily_keywords),
                                                    scrape_limit: parseInt(editingPlan.scrape_limit),
                                                    max_templates: parseInt(editingPlan.max_templates),
                                                    has_premium_access: editingPlan.has_premium_access === 1 || editingPlan.has_premium_access === true,
                                                    perks: perksArray
                                                };

                                                const res = await apiFetch('/api/admin/plans/update', {
                                                    method: 'POST',
                                                    body: JSON.stringify(payload)
                                                });

                                                if (res.ok) {
                                                    setSuccessMsg(`${editingPlan.name} status updated in core engine.`);
                                                    setEditingPlan(null);
                                                    fetchPlans();
                                                } else {
                                                    const errData = await res.json().catch(() => ({}));
                                                    alert(`Update failed: ${errData.detail || 'Unknown Error'}`);
                                                }
                                            } catch (err) {
                                                console.error("Save Error:", err);
                                                alert("Failed to parse configuration for " + editingPlan.name);
                                            }
                                        }}
                                        className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-black py-4 rounded-2xl shadow-lg shadow-indigo-500/20 transition-all uppercase tracking-widest text-xs"
                                    >
                                        Commit Changes to Database
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {activeTab === 'templates' && (
                <div className="bg-white/5 border border-white/5 rounded-[32px] overflow-hidden">
                    <div className="p-8 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400">
                                <FileText size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-xl">Global Templates</h3>
                                <p className="text-xs text-foreground/40 uppercase font-bold tracking-widest mt-1">View all user-created message templates</p>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="text-[10px] uppercase tracking-[0.2em] text-foreground/30 border-b border-white/5">
                                <tr>
                                    <th className="px-6 py-4 font-bold">Creator</th>
                                    <th className="px-6 py-4 font-bold">Template Name</th>
                                    <th className="px-6 py-4 font-bold">Content Preview</th>
                                    <th className="px-6 py-4 font-bold">Created At</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {globalTemplates.map((t) => (
                                    <tr key={t.id} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-bold text-foreground">{t.creator}</div>
                                            <div className="text-[10px] font-mono text-foreground/30">{t.user_id}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-bold text-indigo-400">{t.name}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="text-xs text-foreground/60 max-w-[300px] truncate">{t.content}</div>
                                                <div className="flex items-center gap-1 opacity-10 group-hover:opacity-100 transition-opacity">
                                                    <button 
                                                        onClick={() => setViewingTemplate(t)}
                                                        className="p-1.5 hover:bg-white/10 rounded-md text-foreground/40 hover:text-white"
                                                        title="View Content"
                                                    >
                                                        <Eye size={14} />
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(t.content);
                                                            setSuccessMsg("Copied to clipboard!");
                                                        }}
                                                        className="p-1.5 hover:bg-white/10 rounded-md text-foreground/40 hover:text-indigo-400"
                                                        title="Copy Content"
                                                    >
                                                        <Copy size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-[10px] text-foreground/40">{new Date(t.created_at).toLocaleString()}</div>
                                        </td>
                                    </tr>
                                ))}
                                {globalTemplates.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-foreground/20 italic">No templates found</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
            
            {activeTab === 'settings' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white/5 border border-white/5 p-8 rounded-3xl space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400">
                                <Shield size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">System Passkey</h2>
                                <p className="text-sm text-foreground/40 mt-0.5">Change the gateway passkey</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-foreground/30 mb-2">New Passkey</label>
                                <input
                                    type="text"
                                    value={passkey}
                                    onChange={(e) => setPasskey(e.target.value)}
                                    placeholder="Enter 6-digit passkey"
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>
                            <button
                                onClick={updatePasskey}
                                className="w-full bg-indigo-500 hover:bg-indigo-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-500/20 transition-all"
                            >
                                Update Global Passkey
                            </button>
                        </div>
                    </div>

                    <div className="bg-red-500/5 border border-red-500/10 p-8 rounded-3xl space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-2xl bg-red-500/10 text-red-500">
                                <MasterLock size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold">Admin Password</h2>
                                <p className="text-sm text-foreground/40 mt-0.5">Master administrative key</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-foreground/30 mb-2">New Admin Password</label>
                                <input
                                    type="password"
                                    placeholder="Enter new master key"
                                    className="w-full bg-black/20 border border-white/5 rounded-2xl px-4 py-4 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                                    id="newAdminPass"
                                />
                            </div>
                            <button
                                onClick={async () => {
                                    const val = (document.getElementById('newAdminPass') as HTMLInputElement).value;
                                    if (!val) return;
                                    const res = await apiFetch(`/api/admin/settings?key=admin_password&value=${val}`, { method: 'POST' });
                                    if (res.ok) alert('Admin password updated successfully');
                                }}
                                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-red-600/20 transition-all"
                            >
                                Change Master Password
                            </button>
                        </div>
                    </div>
                    <div className="bg-white/5 border border-white/5 p-8 rounded-3xl space-y-6 opacity-50 cursor-not-allowed">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-2xl bg-orange-500/10 text-orange-400">
                                <Settings size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold font-sans">Admin Security</h2>
                                <p className="text-sm text-foreground/40 mt-0.5">Change administrator password</p>
                            </div>
                        </div>
                        <div className="py-10 text-center text-sm text-foreground/20 italic">
                            Module locked. Manual database update required for master password changes.
                        </div>
                    </div>
                </div>
            )}
            {activeTab === 'monetization' && (
                <div className="space-y-8">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Coupon Creation */}
                        <div className="lg:col-span-1 bg-white/5 border border-white/5 p-8 rounded-[32px] space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-3 bg-indigo-500/10 rounded-2xl text-indigo-400">
                                    <Ticket size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-xl">Create Coupon</h3>
                                    <p className="text-xs text-foreground/40 uppercase font-bold tracking-widest mt-1">Generate access keys</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest px-1">Coupon Code</label>
                                    <input 
                                        type="text" 
                                        placeholder="ARKITEL_VIP_FREE"
                                        value={newCoupon.code}
                                        onChange={(e) => setNewCoupon({...newCoupon, code: e.target.value.toUpperCase()})}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest px-1">Set Price (#)</label>
                                    <input 
                                        type="number" 
                                        placeholder="0"
                                        value={newCoupon.price}
                                        onChange={(e) => setNewCoupon({...newCoupon, price: parseInt(e.target.value) || 0})}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/50 outline-none"
                                    />
                                    <p className="text-[10px] text-foreground/30 px-1 font-medium italic">* Set to 0 for a free automatic unlock code.</p>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 mt-2">
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest px-1">Max Campaigns</label>
                                        <input 
                                            type="number" 
                                            placeholder="Default..."
                                            value={newCoupon.max_daily_campaigns}
                                            onChange={(e) => setNewCoupon({...newCoupon, max_daily_campaigns: e.target.value})}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest px-1">Max Keywords</label>
                                        <input 
                                            type="number" 
                                            placeholder="Default..."
                                            value={newCoupon.max_daily_keywords}
                                            onChange={(e) => setNewCoupon({...newCoupon, max_daily_keywords: e.target.value})}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-bold text-foreground/30 uppercase tracking-widest px-1">Scrape Limit</label>
                                        <input 
                                            type="number" 
                                            placeholder="Default..."
                                            value={newCoupon.scrape_limit}
                                            onChange={(e) => setNewCoupon({...newCoupon, scrape_limit: e.target.value})}
                                            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs focus:ring-1 focus:ring-indigo-500/50 outline-none"
                                        />
                                    </div>
                                </div>
                                <p className="text-[9px] text-foreground/30 px-1 font-medium italic">* Leave above limits blank to use standard premium limits.</p>
                                <button
                                    onClick={async () => {
                                        if (!newCoupon.code) return;
                                        
                                        const payload = {
                                            code: newCoupon.code,
                                            price: newCoupon.price,
                                            max_daily_campaigns: newCoupon.max_daily_campaigns ? parseInt(newCoupon.max_daily_campaigns) : null,
                                            max_daily_keywords: newCoupon.max_daily_keywords ? parseInt(newCoupon.max_daily_keywords) : null,
                                            scrape_limit: newCoupon.scrape_limit ? parseInt(newCoupon.scrape_limit) : null
                                        };

                                        const res = await apiFetch('/api/admin/monetization/coupons', {
                                            method: 'POST',
                                            body: JSON.stringify(payload)
                                        });
                                        if (res.ok) {
                                            setSuccessMsg("Coupon created successfully!");
                                            setNewCoupon({ code: '', price: 5000, max_daily_campaigns: '', max_daily_keywords: '', scrape_limit: '' });

                                            fetchMonetizationData();
                                        }
                                    }}
                                    className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3.5 rounded-2xl shadow-lg shadow-indigo-500/20 transition-all active:scale-95"
                                >
                                    Generate Access Key
                                </button>
                            </div>

                            {/* Active Coupons List */}
                            <div className="space-y-3 pt-6 border-t border-white/5">
                                <h4 className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest px-1">Live Codes</h4>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                    {coupons.map((c) => (
                                        <div key={c.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 group">
                                            <div>
                                                <div className="text-xs font-bold text-foreground">{c.code}</div>
                                                <div className="text-[10px] text-foreground/40 font-bold">{c.price === 0 ? 'FREE ACCESS' : `#${c.price}`} • {c.is_active ? 'Active' : 'Used'}</div>
                                                {c.max_daily_campaigns && (
                                                    <div className="text-[8px] text-indigo-400 mt-0.5 tracking-wider uppercase font-black">
                                                        [CUSTOM] {c.max_daily_campaigns} Camp / {c.max_daily_keywords} Key / {c.scrape_limit} Scr
                                                    </div>
                                                )}
                                            </div>
                                            <button 
                                                onClick={async () => {
                                                    await apiFetch(`/api/admin/monetization/coupons/${c.code}`, { method: 'DELETE' });
                                                    fetchMonetizationData();
                                                }}
                                                className="p-1.5 hover:bg-red-500/10 text-red-500/40 hover:text-red-500 rounded-lg transition-all"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    {coupons.length === 0 && <div className="text-[10px] text-center text-foreground/20 italic py-4">No active coupons</div>}
                                </div>
                            </div>
                        </div>

                        {/* User Plan Management */}
                        <div className="lg:col-span-2 bg-white/5 border border-white/5 rounded-[32px] overflow-hidden flex flex-col">
                            <div className="p-8 border-b border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-3 bg-red-500/10 rounded-2xl text-red-400">
                                        <CreditCard size={24} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-xl">Monetization Registry</h3>
                                        <p className="text-xs text-foreground/40 uppercase font-bold tracking-widest mt-1">Manage user plans & limits</p>
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-x-auto flex-1">
                                <table className="w-full text-left">
                                    <thead className="text-[10px] uppercase tracking-[0.2em] text-foreground/30 border-b border-white/5">
                                        <tr>
                                            <th className="px-6 py-4 font-bold">User</th>
                                            <th className="px-6 py-4 font-bold">Plan</th>
                                            <th className="px-6 py-4 font-bold">Limit / Acc</th>
                                            <th className="px-6 py-4 font-bold">Payment Proof</th>
                                            <th className="px-6 py-4 font-bold">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {monetizationUsers.map((u) => (
                                            <tr key={u.id} className="hover:bg-white/[0.02] transition-colors group/row">
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-foreground text-sm">{u.username}</div>
                                                    <div className="text-[10px] text-foreground/30 font-mono">ID: {u.id}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <select 
                                                            value={u.plan} 
                                                            onChange={async (e) => {
                                                                const newPlan = e.target.value;
                                                                // Optimistically update local state FIRST so UI doesn't snap back
                                                                setMonetizationUsers(prev => prev.map(mu => 
                                                                    mu.id === u.id ? { ...mu, plan: newPlan, is_approved: newPlan === 'free' ? 0 : 1 } : mu
                                                                ));
                                                                const res = await apiFetch(`/api/admin/monetization/users/${u.id}/vitals`, {
                                                                    method: 'POST',
                                                                    body: JSON.stringify({ plan: newPlan, is_approved: newPlan === 'free' ? 0 : 1 })
                                                                });
                                                                if (res.ok) {
                                                                    setSuccessMsg(`Plan set to ${newPlan.toUpperCase()} for ${u.username}`);
                                                                    setTimeout(() => setSuccessMsg(''), 4000);
                                                                } else {
                                                                    setErrorMsg('Failed to update plan. Try again.');
                                                                    setTimeout(() => setErrorMsg(''), 4000);
                                                                }
                                                                fetchMonetizationData();
                                                            }}
                                                            className={`bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase transition-all ${u.plan !== 'free' ? 'text-indigo-400 border-indigo-400/30' : 'text-foreground/20'}`}
                                                        >
                                                            <option value="free">Free</option>
                                                            <option value="basic">Basic</option>
                                                            <option value="standard">Standard</option>
                                                            <option value="premium">Premium</option>
                                                            <option value="unlimited">Unlimited (Admin Only)</option>
                                                        </select>
                                                        {u.plan_activated_at && (
                                                            <div className="text-[9px] font-bold text-foreground/40 mt-1 uppercase tracking-tighter">
                                                                Start: {new Date(u.plan_activated_at).toLocaleDateString()}
                                                            </div>
                                                        )}
                                                        {u.plan_expires_at && (
                                                            <div className="text-[9px] font-bold text-red-400 mt-0.5 uppercase tracking-tighter">
                                                                End: {new Date(u.plan_expires_at).toLocaleDateString()}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-wrap gap-2 max-w-[180px]">
                                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/5">
                                                            <span className="text-[8px] text-foreground/30 font-black">CAMP:</span>
                                                            <span className="text-[10px] font-bold text-indigo-400">{u.daily_campaign_count} / {u.max_daily_campaigns}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/5">
                                                            <span className="text-[8px] text-foreground/30 font-black">KEY:</span>
                                                            <span className="text-[10px] font-bold text-emerald-400">{u.daily_keyword_count} / {u.max_daily_keywords}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/5">
                                                            <span className="text-[8px] text-foreground/30 font-black">SCR:</span>
                                                            <span className="text-[10px] font-bold text-amber-400">{u.scrape_limit}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/5">
                                                            <span className="text-[8px] text-foreground/30 font-black">ACC:</span>
                                                            <span className="text-[10px] font-bold text-blue-400">{u.max_accounts}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md border border-white/5">
                                                            <span className="text-[8px] text-foreground/30 font-black">TMPL:</span>
                                                            <span className="text-[10px] font-bold text-rose-400">{u.max_templates || 1}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {u.payment_proof ? (
                                                        <div className="max-w-[150px] space-y-1">
                                                            <div className="text-[10px] font-medium text-emerald-400 truncate bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20" title={u.payment_proof}>
                                                                {u.payment_proof}
                                                            </div>
                                                            <div className="text-[8px] text-foreground/30 uppercase font-bold text-center">Submitted</div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-[10px] text-foreground/20 italic">No proof</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {u.is_approved === 0 && (
                                                        <button 
                                                            onClick={async () => {
                                                                // Use the plan currently selected in the dropdown (default basic if still free)
                                                                const planToApprove = u.plan === 'free' ? 'basic' : u.plan; 
                                                                if (confirm(`Approve "${planToApprove.toUpperCase()}" plan for ${u.username}?`)) {
                                                                    // 1. Optimistically update local state right away so UI reflects change
                                                                    setMonetizationUsers(prev => prev.map(mu => 
                                                                        mu.id === u.id ? { ...mu, plan: planToApprove, is_approved: 1 } : mu
                                                                    ));
                                                                    // 2. Send to backend
                                                                    const res = await apiFetch(`/api/admin/monetization/users/${u.id}/vitals`, {
                                                                        method: 'POST',
                                                                        body: JSON.stringify({ plan: planToApprove, is_approved: 1 })
                                                                    });
                                                                    if (res.ok) {
                                                                        setSuccessMsg(`✅ Approved ${u.username} for ${planToApprove}!`);
                                                                        setTimeout(() => setSuccessMsg(''), 4000);
                                                                    } else {
                                                                        setErrorMsg('Approval failed. Check server logs.');
                                                                        setTimeout(() => setErrorMsg(''), 4000);
                                                                    }
                                                                    // 3. Re-fetch to verify backend committed the change
                                                                    fetchMonetizationData();
                                                                }
                                                            }}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-[10px] font-bold uppercase transition-all hover:bg-emerald-400 active:scale-95 shadow-lg shadow-emerald-500/20"
                                                        >
                                                            <CheckCircle2 size={12} /> Approve
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {activeTab === 'maintenance' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white/5 border border-white/5 p-8 rounded-3xl space-y-6">
                        <div className="flex items-center gap-3 text-orange-400">
                            <Trash2 size={24} />
                            <h2 className="text-xl font-bold">Data Management</h2>
                        </div>
                        <p className="text-sm text-foreground/40">Clean up database tables to maintain performance.</p>
                        <div className="space-y-3">
                            <button
                                onClick={async () => {
                                    if (confirm("Purge all leads data?")) {
                                        await apiFetch("/api/admin/maintenance/clear-leads", { method: 'POST' });
                                        alert("Leads table cleared.");
                                    }
                                }}
                                className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-red-500/10 hover:text-red-500 transition-all group border border-white/5"
                            >
                                <span className="text-sm font-bold">Clear All Leads</span>
                                <Database size={18} className="opacity-20 group-hover:opacity-100" />
                            </button>
                            <button
                                onClick={async () => {
                                    if (confirm("Purge historical task data? (Only completed/failed tasks)")) {
                                        await apiFetch("/api/admin/maintenance/clear-tasks", { method: 'POST' });
                                        alert("Task history purged.");
                                    }
                                }}
                                className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-orange-500/10 hover:text-orange-500 transition-all group border border-white/5"
                            >
                                <span className="text-sm font-bold">Purge Task History</span>
                                <Activity size={18} className="opacity-20 group-hover:opacity-100" />
                            </button>
                            <button
                                onClick={async () => {
                                    if (confirm("DELETE ALL USER TEMPLATES? This cannot be undone.")) {
                                        const res = await apiFetch("/api/admin/maintenance/clear-templates", { method: 'POST' });
                                        if (res.ok) {
                                            alert("All user templates successfully deleted.");
                                            setGlobalTemplates([]);
                                        }
                                    }
                                }}
                                className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-purple-500/10 hover:text-purple-500 transition-all group border border-white/5"
                            >
                                <span className="text-sm font-bold">Clear All User Templates</span>
                                <FileText size={18} className="opacity-20 group-hover:opacity-100" />
                            </button>
                            <button
                                onClick={async () => {
                                    if (confirm("Purge all user search keywords?")) {
                                        const res = await apiFetch("/api/admin/maintenance/clear-keyword-logs", { method: 'POST' });
                                        if (res.ok) {
                                            alert("Keyword logs purged.");
                                            setKeywordLogs([]);
                                        }
                                    }
                                }}
                                className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-amber-500/10 hover:text-amber-500 transition-all group border border-white/5"
                            >
                                <span className="text-sm font-bold">Clear Keyword History</span>
                                <Search size={18} className="opacity-20 group-hover:opacity-100" />
                            </button>
                        </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 p-8 rounded-3xl space-y-6">
                        <div className="flex items-center gap-3 text-indigo-400">
                            <Shield size={24} />
                            <h2 className="text-xl font-bold">System Health</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-foreground/30 uppercase font-bold tracking-wider mb-1">Database</div>
                                <div className="text-sm font-bold text-emerald-500">{stats?.service_health?.database || 'Healthy'}</div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-foreground/30 uppercase font-bold tracking-wider mb-1">Worker</div>
                                <div className="text-sm font-bold text-indigo-500">{stats?.service_health?.poller || 'Active'}</div>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <div className="text-[10px] text-foreground/30 uppercase font-bold tracking-wider mb-1">Pooled Nodes</div>
                                <div className="text-sm font-bold text-amber-500">{stats?.service_health?.pool_active_nodes || 0} Open</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 rounded-[32px] p-8">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-3 bg-amber-500/10 rounded-2xl text-amber-500">
                                <Megaphone size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">System Broadcast</h3>
                                <p className="text-sm text-foreground/40">Send alert to all user dashboards</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <textarea 
                                value={broadcastMsg}
                                onChange={(e) => setBroadcastMsg(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 min-h-[100px]"
                                placeholder="Enter system announcement..."
                            />
                            <div className="flex gap-3">
                                <select 
                                    value={broadcastType}
                                    onChange={(e) => setBroadcastType(e.target.value)}
                                    className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none"
                                >
                                    <option value="info">Info (Blue)</option>
                                    <option value="warning">Warning (Amber)</option>
                                    <option value="success">Success (Green)</option>
                                </select>
                                <button
                                    onClick={async () => {
                                        if (!broadcastMsg) return;
                                        setSendingBroadcast(true);
                                        const res = await apiFetch(`/api/admin/broadcast?message=${encodeURIComponent(broadcastMsg)}&type=${broadcastType}`, { method: 'POST' });
                                        if (res.ok) {
                                            alert("Broadcast Sent!");
                                            setBroadcastMsg('');
                                            fetchAdminData();
                                        }
                                        setSendingBroadcast(false);
                                    }}
                                    disabled={sendingBroadcast}
                                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold py-2 rounded-xl text-sm transition-all disabled:opacity-50"
                                >
                                    {sendingBroadcast ? 'Sending...' : 'Publish Broadcast'}
                                </button>
                            </div>
                        </div>

                        {stats?.broadcasts && stats.broadcasts.length > 0 && (
                            <div className="mt-8 space-y-3">
                                <p className="text-[10px] font-bold text-foreground/30 uppercase tracking-widest px-1">Active Broadcasts</p>
                                {stats.broadcasts.map((b: any) => (
                                    <div key={b.id} className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium">{b.message}</span>
                                            <span className="text-[10px] text-foreground/30">{new Date(b.created_at).toLocaleString()} • <span className="uppercase text-amber-500/50">{b.type}</span></span>
                                        </div>
                                        <button 
                                            onClick={async () => {
                                                if (confirm("Delete this broadcast?")) {
                                                    await apiFetch(`/api/admin/broadcast/${b.id}`, { method: 'DELETE' });
                                                    fetchAdminData();
                                                }
                                            }}
                                            className="p-2 hover:bg-red-500/10 text-red-500/50 hover:text-red-500 rounded-lg transition-all"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'search-logs' && (
                <div className="bg-white/5 border border-white/5 rounded-[32px] overflow-hidden shadow-2xl">
                    <div className="p-8 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-amber-500/10 rounded-2xl text-amber-500">
                                <Search size={24} />
                            </div>
                            <div>
                                <h3 className="font-bold text-xl text-white">Scraper Search Queries</h3>
                                <p className="text-xs text-foreground/40 uppercase font-black tracking-[0.2em] mt-1">Live audit log of all keywords used</p>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto overflow-y-auto max-h-[600px] custom-scrollbar">
                        <table className="w-full text-left">
                            <thead className="text-[10px] uppercase tracking-[0.2em] text-foreground/30 border-b border-white/5 sticky top-0 bg-[#0d0d0e] z-10">
                                <tr>
                                    <th className="px-8 py-5 font-black">User Identity</th>
                                    <th className="px-8 py-5 font-black">Active Keyword</th>
                                    <th className="px-8 py-5 font-black">Timestamp</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 bg-white/[0.01]">
                                {keywordLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-amber-500/[0.03] transition-colors group">
                                        <td className="px-8 py-5">
                                            <div className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">{log.username}</div>
                                            <div className="text-[10px] font-mono text-foreground/20 mt-0.5 tracking-tighter">ID: {log.user_id}</div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <div className="px-4 py-2 bg-amber-500/5 border border-amber-500/10 rounded-xl text-sm font-mono text-amber-500 inline-block font-black tracking-widest shadow-lg shadow-amber-500/5">
                                                {log.keyword}
                                            </div>
                                        </td>
                                        <td className="px-8 py-5">
                                            <div className="text-[10px] text-foreground/40 font-bold uppercase tracking-widest">{new Date(log.created_at).toLocaleString()}</div>
                                        </td>
                                    </tr>
                                ))}
                                {keywordLogs.length === 0 && (
                                    <tr>
                                        <td colSpan={3} className="px-8 py-24 text-center text-foreground/20 italic font-mono text-xs tracking-[0.2em] uppercase">
                                            No search intelligence captured yet
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* User Detail Overlay */}
            {selectedUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-background/80 backdrop-blur-3xl animate-in fade-in duration-300">
                    <div className="bg-card border border-border rounded-[32px] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                        <div className="p-8 border-b border-border flex items-center justify-between bg-foreground/[0.02]">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                    <Users size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-foreground">{selectedUser.username}</h3>
                                    <p className="text-xs text-foreground/40 font-mono mt-0.5">{selectedUser.id}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedUser(null)}
                                className="p-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/50 transition-colors"
                            >
                                <X size={20} />
                                <span className="sr-only">Close</span>
                            </button>
                        </div>

                        <div className="p-8 overflow-y-auto space-y-8">
                            {loadingDetails ? (
                                <div className="flex items-center justify-center py-12">
                                    <Activity className="animate-spin text-indigo-500" size={32} />
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="bg-foreground/[0.03] p-5 rounded-2xl border border-border/50">
                                            <div className="text-[10px] text-foreground/50 uppercase font-bold tracking-wider mb-1">Accounts</div>
                                            <div className="text-2xl font-bold text-foreground">{userDetails?.accounts?.length || 0}</div>
                                        </div>
                                        <div className="bg-foreground/[0.03] p-5 rounded-2xl border border-border/50">
                                            <div className="text-[10px] text-foreground/50 uppercase font-bold tracking-wider mb-1">Total Scrapes</div>
                                            <div className="text-2xl font-bold text-foreground">{userDetails?.total_scrapes || 0}</div>
                                        </div>
                                        <div className="bg-foreground/[0.03] p-5 rounded-2xl border border-border/50">
                                            <div className="text-[10px] text-foreground/50 uppercase font-bold tracking-wider mb-1">Active Status</div>
                                            <div className={`text-lg font-bold ${selectedUser.is_active ? 'text-green-500' : 'text-red-500'}`}>
                                                {selectedUser.is_active ? 'Healthy' : 'Suspended'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h4 className="text-sm font-bold text-foreground/60 uppercase tracking-widest">Connected Phone Numbers</h4>
                                        <div className="grid grid-cols-1 gap-2">
                                            {userDetails?.accounts?.map((acc: any, idx: number) => (
                                                <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-foreground/[0.03] border border-border/50">
                                                    <span className="font-mono text-sm text-foreground">{acc.phone_number}</span>
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${acc.status === 'active' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                                                        {acc.status}
                                                    </span>
                                                </div>
                                            )) || <div className="text-xs text-foreground/30 py-4 italic">No accounts linked</div>}
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <h4 className="text-sm font-bold text-foreground/60 uppercase tracking-widest">Campaign Overview</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                            {userDetails?.campaign_summary && Object.entries(userDetails.campaign_summary).map(([status, count]: [any, any]) => (
                                                <div key={status} className="bg-foreground/[0.03] p-3 rounded-xl border border-border/50">
                                                    <div className="text-[9px] text-foreground/50 uppercase font-bold mb-1">{status}</div>
                                                    <div className="text-lg font-bold text-foreground">{count}</div>
                                                </div>
                                            ))}
                                            {(!userDetails?.campaign_summary || Object.keys(userDetails.campaign_summary).length === 0) && (
                                                <div className="col-span-4 text-xs text-foreground/30 py-4 italic">No campaign activity found</div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="p-6 bg-white/[0.01] border-t border-white/5 flex justify-end gap-3">
                            <button
                                onClick={async () => {
                                    if (confirm(`PURGE ALL LEADS for ${selectedUser.username}? This cannot be undone.`)) {
                                        const res = await apiFetch(`/api/admin/users/${selectedUser.id}/leads`, { method: 'DELETE' });
                                        if (res.ok) alert("User leads purged.");
                                    }
                                }}
                                className="px-6 py-2.5 rounded-xl bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 text-sm font-bold transition-all"
                            >
                                Purge User Leads
                            </button>
                            <button
                                onClick={() => {
                                    toggleUserStatus(selectedUser.id);
                                    setSelectedUser((prev: any) => ({ ...prev, is_active: !prev.is_active }));
                                }}
                                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${selectedUser.is_active ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' : 'bg-green-500/10 text-green-500 hover:bg-green-500/20'}`}
                            >
                                {selectedUser.is_active ? 'Suspend Account' : 'Reactivate Account'}
                            </button>
                            <button
                                onClick={() => setSelectedUser(null)}
                                className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-bold transition-all"
                            >
                                Close Detailed View
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Template Viewing Modal */}
            {viewingTemplate && (
                <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/90 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[#2a2a2c] border border-white/10 rounded-[24px] w-full max-w-lg shadow-2xl relative p-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-400">
                                    <FileText size={18} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-base text-white">{viewingTemplate.name}</h3>
                                    <p className="text-[9px] text-foreground/40 uppercase font-black tracking-widest">User: {viewingTemplate.creator}</p>
                                </div>
                            </div>
                            <button onClick={() => setViewingTemplate(null)} className="p-1.5 hover:bg-white/5 rounded-lg text-foreground/30 hover:text-white transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="bg-[#1e1e1f] border border-white/5 rounded-xl p-5 mb-5 max-h-[350px] overflow-y-auto custom-scrollbar">
                            <pre className="text-sm text-foreground/70 whitespace-pre-wrap font-sans leading-relaxed tracking-wide">
                                {viewingTemplate.content}
                            </pre>
                        </div>

                        <div className="flex gap-2">
                            <button 
                                onClick={() => {
                                    navigator.clipboard.writeText(viewingTemplate.content);
                                    setSuccessMsg("System: Message copied.");
                                    setViewingTemplate(null);
                                }}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
                            >
                                <Copy size={14} />
                                Copy Template
                            </button>
                            <button 
                                onClick={() => setViewingTemplate(null)}
                                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all font-bold text-xs"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification Toast */}
            {successMsg && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-3 px-6 py-3 bg-emerald-500 text-white rounded-full shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <CheckCircle2 size={16} />
                    <span className="text-sm font-bold">{successMsg}</span>
                    <button onClick={() => setSuccessMsg('')} className="ml-2 hover:opacity-50 transition-opacity">
                        <X size={14} />
                    </button>
                </div>
            )}
            
            {errorMsg && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-3 px-6 py-3 bg-red-500 text-white rounded-full shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <AlertCircle size={16} />
                    <span className="text-sm font-bold">{errorMsg}</span>
                    <button onClick={() => setErrorMsg('')} className="ml-2 hover:opacity-50 transition-opacity">
                        <X size={14} />
                    </button>
                </div>
            )}

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
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
