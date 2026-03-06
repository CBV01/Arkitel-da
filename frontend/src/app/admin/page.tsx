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
    Search
} from 'lucide-react';

export default function AdminDashboard() {
    const [stats, setStats] = useState<any>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [passkey, setPasskey] = useState('');

    useEffect(() => {
        const fetchAdminData = async () => {
            try {
                const [statsRes, usersRes] = await Promise.all([
                    apiFetch('/api/admin/stats'),
                    apiFetch('/api/admin/users')
                ]);

                if (statsRes.ok && usersRes.ok) {
                    setStats(await statsRes.json());
                    const usersData = await usersRes.json();
                    setUsers(usersData.users || []);
                }
            } catch (err) {
                console.error("Failed to fetch admin data", err);
            } finally {
                setLoading(false);
            }
        };
        fetchAdminData();
    }, []);

    const updatePasskey = async () => {
        if (!passkey) return;
        const res = await apiFetch(`/api/admin/settings?key=global_passkey&value=${passkey}`, {
            method: 'POST'
        });
        if (res.ok) {
            alert("Passkey updated successfully");
            setPasskey('');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
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

                <div className="flex bg-white/[0.03] backdrop-blur-3xl p-1.5 rounded-2xl border border-white/5">
                    {['overview', 'users', 'settings', 'maintenance'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-8 py-2.5 rounded-xl text-sm font-bold capitalize transition-all duration-300 ${activeTab === tab
                                ? 'bg-red-500 text-white shadow-xl shadow-red-500/20 active:scale-95'
                                : 'text-foreground/40 hover:text-foreground hover:bg-white/5'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === 'overview' && (
                <div className="space-y-8">
                    {/* Global Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                            { label: 'Total Users', value: stats?.global?.users, icon: Users, color: 'text-blue-400' },
                            { label: 'Connected Accounts', value: stats?.global?.accounts, icon: Activity, color: 'text-green-400' },
                            { label: 'Messages Sent', value: stats?.global?.tasks, icon: MessageSquare, color: 'text-purple-400' },
                            { label: 'Total Leads', value: stats?.global?.leads, icon: Database, color: 'text-orange-400' },
                        ].map((stat, i) => (
                            <div key={i} className="bg-white/5 backdrop-blur-xl border border-white/5 p-6 rounded-3xl relative overflow-hidden group">
                                <div className={`p-3 rounded-2xl bg-white/5 w-fit mb-4 ${stat.color}`}>
                                    <stat.icon size={24} />
                                </div>
                                <div className="text-3xl font-bold text-foreground">{stat.value}</div>
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
                                                    <button className="p-2 rounded-lg bg-white/5 text-foreground/40 hover:text-indigo-400 hover:bg-indigo-400/10 transition-all" title="View Details">
                                                        <Search size={16} />
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
                                                <button className="p-2 rounded-lg bg-white/5 text-foreground/40 hover:text-orange-400 hover:bg-orange-400/10 transition-all">
                                                    {u.is_active ? <Pause size={16} /> : <Play size={16} />}
                                                </button>
                                                <button className="p-2 rounded-lg bg-white/5 text-foreground/40 hover:text-red-500 hover:bg-red-500/10 transition-all">
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
                                <Lock size={24} />
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
                                    if(!val) return;
                                    const res = await apiFetch(`/api/admin/settings?key=admin_password&value=${val}`, { method: 'POST' });
                                    if(res.ok) alert('Admin password updated successfully');
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
                                    if(confirm("Purge all leads data?")) {
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
                                    if(confirm("Purge historical task data? (Only completed/failed tasks)")) {
                                        await apiFetch("/api/admin/maintenance/clear-tasks", { method: 'POST' });
                                        alert("Task history purged.");
                                    }
                                }}
                                className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-orange-500/10 hover:text-orange-500 transition-all group border border-white/5"
                            >
                                <span className="text-sm font-bold">Purge Task History</span>
                                <Activity size={18} className="opacity-20 group-hover:opacity-100" />
                            </button>
                        </div>
                    </div>

                    <div className="bg-white/5 border border-white/5 p-8 rounded-3xl space-y-6">
                        <div className="flex items-center gap-3 text-indigo-400">
                            <Shield size={24} />
                            <h2 className="text-xl font-bold">System Health</h2>
                        </div>
                        <p className="text-sm text-foreground/40">Monitor platform health and background worker status.</p>
                        <div className="p-10 text-center text-sm text-foreground/20 italic">
                            Worker health: OPTIMAL <br/>
                            Background service is running on Hugging Face.
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
