'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { CampaignsList } from '../components/CampaignsList';
import { CampaignStudio } from '../components/CampaignStudio';
import { TemplatesView } from '../components/TemplatesView';
import { CustomersView } from '../components/CustomersView';
import { SettingsView } from '../components/SettingsView';
import { ActivityView } from '../components/ActivityView';
import { LoginModal } from '../components/LoginModal';
import { api, getStoredUser, getAuthToken, UserProfile } from '../lib/api';
import { ShieldAlert } from 'lucide-react';

export default function AutoCampaignsPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentTab, setCurrentTab] = useState<'campaigns' | 'activity' | 'templates' | 'customers' | 'settings'>('campaigns');
  const [activeStudioType, setActiveStudioType] = useState<'birthday' | 'anniversary' | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    const stored = getStoredUser();
    if (token && stored) {
      setUser(stored);
    }
    setAuthChecked(true);
  }, []);

  const handleLogout = () => {
    api.logout();
    setUser(null);
  };

  const breadcrumbs = activeStudioType
    ? ['GroVastra', 'Auto Campaigns', `${activeStudioType === 'birthday' ? 'Birthday' : 'Anniversary'} Campaign`, 'Setup Wizard']
    : ['GroVastra', 'Auto Campaigns', currentTab === 'activity' ? 'Activity Stream' : currentTab.charAt(0).toUpperCase() + currentTab.slice(1)];

  return (
    <div className="flex min-h-screen bg-[#FAF8F5]">
      {/* Login Modal shown when unauthenticated */}
      {authChecked && !user && (
        <LoginModal
          onSuccess={(authenticatedUser) => {
            setUser(authenticatedUser);
          }}
        />
      )}

      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        user={user}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setActiveStudioType(null);
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header breadcrumbs={breadcrumbs} user={user} onLogout={handleLogout} />

        {/* Role Banner for Staff: Staff can view activity and resolve holds */}
        {user?.role === 'STAFF' && (currentTab === 'campaigns' || currentTab === 'settings') && (
          <div className="bg-[#FEF9EE] border-b border-[#F3E0B5] px-6 py-2.5 flex items-center justify-between text-xs text-[#8F6910]">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#C99726]" />
              <span>
                <strong>Staff Access View:</strong> You have permission to view activity streams and resolve patron sales holds. Campaign publishing and global settings edits require Owner/Manager credentials.
              </span>
            </div>
            <button
              onClick={() => setCurrentTab('activity')}
              className="text-xs font-semibold underline hover:text-[#5C1D24]"
            >
              Switch to Activity Stream
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          {activeStudioType ? (
            <CampaignStudio
              campaignType={activeStudioType}
              onBack={() => setActiveStudioType(null)}
              onActivateSuccess={() => {
                setActiveStudioType(null);
                setCurrentTab('campaigns');
              }}
            />
          ) : currentTab === 'campaigns' ? (
            <CampaignsList onOpenStudio={(type) => setActiveStudioType(type)} />
          ) : currentTab === 'activity' ? (
            <ActivityView />
          ) : currentTab === 'templates' ? (
            <TemplatesView />
          ) : currentTab === 'customers' ? (
            <CustomersView />
          ) : (
            <SettingsView />
          )}
        </main>
      </div>
    </div>
  );
}
