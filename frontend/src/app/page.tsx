'use client';

import React, { useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { CampaignsList } from '../components/CampaignsList';
import { CampaignStudio } from '../components/CampaignStudio';
import { TemplatesView } from '../components/TemplatesView';
import { CustomersView } from '../components/CustomersView';
import { SettingsView } from '../components/SettingsView';
import { ActivityView } from '../components/ActivityView';

export default function AutoCampaignsPage() {
  const [currentTab, setCurrentTab] = useState<'campaigns' | 'activity' | 'templates' | 'customers' | 'settings'>('campaigns');
  const [activeStudioType, setActiveStudioType] = useState<'birthday' | 'anniversary' | null>(null);

  const breadcrumbs = activeStudioType
    ? ['GroVastra', 'Auto Campaigns', `${activeStudioType === 'birthday' ? 'Birthday' : 'Anniversary'} Campaign`, 'Setup Wizard']
    : ['GroVastra', 'Auto Campaigns', currentTab === 'activity' ? 'Activity Stream' : currentTab.charAt(0).toUpperCase() + currentTab.slice(1)];

  return (
    <div className="flex min-h-screen bg-[#FAF8F5]">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          setActiveStudioType(null);
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header breadcrumbs={breadcrumbs} />

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
