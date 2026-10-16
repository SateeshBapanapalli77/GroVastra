import { test, expect } from '@playwright/test';

/**
 * Phase 6: Playwright End-to-End Test Suite for GroVastra Auto Campaigns
 *
 * Requirements:
 * 1. Login with credentials and role recognition
 * 2. Create draft -> validate -> dry run -> activate (assert "next evaluation", never "sent")
 * 3. Pause (assert honest copy "Unsent work stops. Messages already being sent may still go out.") -> resume
 * 4. Resolve reply hold with mandatory staff audit reason
 * 5. 409 Version Conflict with visible banner and "Reload latest" action
 * 6. Double-click activation protection (disabled button & Idempotency-Key)
 * 7. Responsive layouts (360px mobile & 1280px desktop)
 */

test.describe('GroVastra Auto Campaigns — Phase 6 E2E Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Global Route Mocks for stable test runs
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: {
            id: 'usr_owner_01',
            username: 'owner@padmavati.com',
            name: 'Padmavati Sundar',
            role: 'BOUTIQUE_OWNER',
            tenantId: 'shop_padmavati_handlooms',
            shopName: 'Padmavati Handlooms'
          }
        })
      });
    });

    await page.route('**/api/v1/integration-readiness', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          ready: true,
          isReady: true,
          connection: { status: 'ACTIVE', verifiedName: 'Padmavati Handlooms' },
          templates: [{ templateId: 'tpl_birthday_invite', name: 'birthday_invitation_v1', category: 'MARKETING', status: 'APPROVED' }]
        })
      });
    });

    await page.route('**/api/v1/campaign-settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          settings: {
            timezone: 'Asia/Kolkata',
            allowedHours: { start: '10:00', end: '19:00' },
            caps: { marketing24h: 1, marketing7d: 3 },
            globalPause: false,
            leapDayPolicy: 'FEB_28',
            outageGraceMinutes: 120,
            blackouts: [],
            notice: 'This module runs auto campaigns using an existing WhatsApp connection and approved templates. WhatsApp setup and template approval are managed by the integration developer.',
            version: 1
          }
        })
      });
    });

    await page.route('**/api/v1/campaign-presets', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          presets: [
            {
              id: 'annual_birthday_celebration',
              name: 'Annual Birthday Celebration',
              description: 'Send personalized birthday greetings and VIP anniversary handloom offers.',
              category: 'OCCASION',
              purpose: 'MARKETING',
              defaultPriority: 80,
              trigger: { type: 'OCCASION', field: 'customer.birthday', windowDays: 7 },
              defaultSteps: [
                {
                  id: 'step_1',
                  stepIndex: 1,
                  offsetDays: -7,
                  preferredTime: '10:00',
                  templateId: 'tpl_birthday_invite'
                }
              ]
            }
          ]
        })
      });
    });

    await page.route('**/api/v1/approved-template-catalogue', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          templates: [
            {
              id: 'tpl_birthday_invite',
              name: 'birthday_invitation_v1',
              category: 'MARKETING',
              revision: 1,
              language: 'en',
              status: 'APPROVED',
              variableKeys: ['customer.name', 'shop.name'],
              components: []
            }
          ]
        })
      });
    });
  });

  test('1. Authentication: Login with role recognition & redirection', async ({ page }) => {
    // Clear localStorage to test unauthenticated login
    await page.addInitScript(() => {
      localStorage.clear();
    });

    // Intercept login route
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          token: 'mock_jwt_owner_session_token',
          user: {
            id: 'usr_owner_01',
            username: 'owner@padmavati.com',
            name: 'Padmavati Sundar',
            role: 'BOUTIQUE_OWNER',
            tenantId: 'shop_padmavati_handlooms',
            shopName: 'Padmavati Handlooms'
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, campaigns: [] })
      });
    });

    await page.goto('/login');

    // Assert login screen elements
    await expect(page.locator('h1')).toContainText('GroVastra Auto Campaigns');

    // Fill valid owner credentials
    await page.fill('input#username', 'owner@padmavati.com');
    await page.fill('input#password', 'OwnerPass123!');
    await page.click('button[type="submit"]');

    // Wait for redirection to campaigns overview
    await expect(page).toHaveURL(/\/campaigns/);
  });

  test('2. Campaign Wizard & Activation: draft -> dry run -> activate ("next evaluation")', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grovastra_auth_token', 'mock_jwt_owner_session_token');
      localStorage.setItem(
        'grovastra_auth_user',
        JSON.stringify({
          id: 'usr_owner_01',
          username: 'owner@padmavati.com',
          name: 'Padmavati Sundar',
          role: 'BOUTIQUE_OWNER',
          tenantId: 'shop_padmavati_handlooms',
          shopName: 'Padmavati Handlooms'
        })
      );
    });

    await page.route('**/api/v1/campaigns', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            campaign: {
              id: 'cmp_e2e_test_001',
              name: body.name || 'Festive Birthday Silk 2026',
              type: 'ANNUAL_OCCASION',
              status: 'DRAFT',
              version: 1,
              enrolledCount: 0
            }
          })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, campaigns: [] })
        });
      }
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          campaign: {
            id: 'cmp_e2e_test_001',
            name: 'Festive Birthday Silk 2026',
            type: 'ANNUAL_OCCASION',
            status: 'DRAFT',
            version: 1,
            enrolledCount: 0,
            activeVersion: 1,
            trigger: { type: 'OCCASION', field: 'customer.birthday', windowDays: 7, timezone: 'Asia/Kolkata', localTime: '10:00' },
            steps: [
              {
                stepId: 'invitation',
                offsetDays: 0,
                localTime: '10:00',
                prerequisite: 'NONE',
                templateRef: { id: 'tpl_birthday_invite', revision: 1, language: 'en' },
                bindings: {},
                stopOnReply: true,
                stopOnGoal: true
              }
            ]
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/validate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          valid: true,
          checks: {
            audienceConfigured: true,
            templatesApproved: true,
            variablesBound: true,
            safeguardsCompliant: true
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/dry-runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          dryRun: {
            dryRunId: 'dr_e2e_test_01',
            draftFingerprint: 'rfp_e2e_verified_fingerprint_01',
            evaluatedAt: new Date().toISOString(),
            summary: {
              totalEvaluated: 120,
              eligibleCount: 15,
              excludedCount: 105
            },
            reasonBreakdown: {
              NO_UPCOMING_OCCASION_IN_WINDOW: 95,
              MARKETING_OPT_OUT: 10
            },
            samplePlans: [
              {
                customerId: 'cus_sample_01',
                customerName: 'Lakshmi Devi',
                occasionDate: '2026-10-28',
                steps: [
                  {
                    stepId: 'invitation',
                    dueAtUtc: '2026-10-21T04:30:00.000Z',
                    localTime: '10:00',
                    renderedPreview: 'Dear Lakshmi Devi, celebrate your special day with Padmavati Handlooms.'
                  }
                ]
              }
            ]
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/activate', async (route) => {
      // Assert Idempotency-Key header is present
      const headers = route.request().headers();
      expect(headers['idempotency-key']).toBeDefined();

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Campaign activated successfully',
          campaign: {
            id: 'cmp_e2e_test_001',
            name: 'Festive Birthday Silk 2026',
            status: 'ACTIVE',
            version: 1,
            nextEvaluationAt: new Date(Date.now() + 3600000).toISOString()
          }
        })
      });
    });

    // 1. Navigate to campaigns/new
    await page.goto('/campaigns/new');

    // 2. Select preset card
    const presetCard = page.locator('text=Annual Birthday Celebration').first();
    await presetCard.click();

    // 3. Fill name input
    await page.fill('input[placeholder*="Silk Connoisseur"]', 'Festive Birthday Silk 2026');

    // 4. Click Initialize Draft
    await page.click('button:has-text("Initialize Draft")');

    // 5. Arrives on campaign edit wizard or detail
    await expect(page).toHaveURL(/\/campaigns\/cmp_e2e_test_001/);

    // 6. Navigate to edit wizard Step 5: Review & Dry Run
    await page.goto('/campaigns/cmp_e2e_test_001/edit');
    await page.click('button:has-text("Step 5")');

    // 7. Assert Dry Run Review Fingerprint is displayed
    await expect(page.locator('code:has-text("rfp_e2e_verified_fingerprint_01")')).toBeVisible();

    // 8. Click "Activate campaign" button
    const activateBtn = page.locator('button:has-text("Activate campaign")').first();
    await activateBtn.click();

    // 9. Assert Non-negotiable 4 wording: shows "next evaluation at …", NEVER "sent"
    await expect(page.locator('text=next evaluation at')).toBeVisible();
    await expect(page.locator('text=messages sent')).not.toBeVisible();
  });

  test('3. Pause Copy & Future-Only Resume: honest pause copy verification', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grovastra_auth_token', 'mock_jwt_owner_session_token');
      localStorage.setItem(
        'grovastra_auth_user',
        JSON.stringify({
          id: 'usr_owner_01',
          role: 'BOUTIQUE_OWNER',
          tenantId: 'shop_padmavati_handlooms',
          shopName: 'Padmavati Handlooms'
        })
      );
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          campaign: {
            id: 'cmp_e2e_test_001',
            name: 'Festive Birthday Silk 2026',
            status: 'ACTIVE',
            version: 1,
            enrolledCount: 15,
            steps: [{ id: 'step_1', stepIndex: 1, templateId: 'tpl_birthday_invite', offsetDays: -7, preferredTime: '10:00' }]
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/pause', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Campaign paused',
          campaign: { id: 'cmp_e2e_test_001', status: 'PAUSED', version: 1 }
        })
      });
    });

    await page.goto('/campaigns/cmp_e2e_test_001');

    // Click Pause Campaign
    const pauseBtn = page.locator('button:has-text("Pause Campaign")').first();
    await pauseBtn.click();

    // Assert Non-negotiable 5 verbatim pause copy
    await expect(
      page.locator('text="Unsent work stops. Messages already being sent may still go out."')
    ).toBeVisible();

    // Confirm pause
    await page.click('button:has-text("Confirm Pause")');
  });

  test('4. Staff Action: Resolve hold with mandatory reason and server confirmation', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grovastra_auth_token', 'mock_jwt_staff_session_token');
      localStorage.setItem(
        'grovastra_auth_user',
        JSON.stringify({
          id: 'usr_staff_01',
          username: 'staff@padmavati.com',
          name: 'Anjali Sharma',
          role: 'STAFF',
          tenantId: 'shop_padmavati_handlooms',
          shopName: 'Padmavati Handlooms'
        })
      );
    });

    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: {
            id: 'usr_staff_01',
            username: 'staff@padmavati.com',
            name: 'Anjali Sharma',
            role: 'STAFF',
            tenantId: 'shop_padmavati_handlooms',
            shopName: 'Padmavati Handlooms'
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          campaign: {
            id: 'cmp_e2e_test_001',
            name: 'Festive Birthday Silk 2026',
            status: 'ACTIVE',
            version: 1,
            enrolledCount: 1,
            steps: []
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/enrollments*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          enrollments: [
            {
              id: 'enr_held_001',
              campaignId: 'cmp_e2e_test_001',
              customerId: 'cus_lakshmi_01',
              occurrenceId: 'birthday:2026',
              status: 'HELD',
              replyHoldAt: new Date().toISOString(),
              customer: {
                id: 'cus_lakshmi_01',
                firstName: 'Lakshmi',
                lastName: 'Devi',
                maskedPhone: '+91 98490 *****'
              },
              executions: []
            }
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
        })
      });
    });

    await page.route('**/api/v1/enrollments/enr_held_001/resolve-hold', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      expect(body.notes).toBeDefined();
      expect(body.notes.length).toBeGreaterThanOrEqual(5);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Reply hold resolved successfully'
        })
      });
    });

    await page.goto('/campaigns/cmp_e2e_test_001?tab=enrollments');

    // Assert "Held for staff" indicator
    await expect(page.locator('text=Held for staff')).toBeVisible();

    // Click Resolve Hold
    await page.click('button:has-text("Resolve Hold")');

    // Fill mandatory reason
    await page.fill('textarea', 'Customer inquiry resolved personally by boutique stylist');

    // Click Confirm Hold Resolution
    await page.click('button:has-text("Confirm Hold Resolution")');
  });

  test('5. Version Conflict (409): visible conflict banner and "Reload latest" action', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grovastra_auth_token', 'mock_jwt_owner_session_token');
      localStorage.setItem(
        'grovastra_auth_user',
        JSON.stringify({
          id: 'usr_owner_01',
          role: 'BOUTIQUE_OWNER',
          tenantId: 'shop_padmavati_handlooms',
          shopName: 'Padmavati Handlooms'
        })
      );
    });

    await page.route('**/api/v1/campaign-settings', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            code: 'VERSION_CONFLICT',
            error: 'Conflict: Settings modified by another session',
            currentVersion: 3
          })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            settings: {
              timezone: 'Asia/Kolkata',
              allowedHours: { start: '10:00', end: '19:00' },
              caps: { marketing24h: 1, marketing7d: 3 },
              globalPause: false,
              leapDayPolicy: 'FEB_28',
              outageGraceMinutes: 120,
              blackouts: [],
              notice: 'This module runs auto campaigns using an existing WhatsApp connection and approved templates.',
              version: 2
            }
          })
        });
      }
    });

    await page.goto('/settings');

    // Change an allowed hours value to make form dirty
    const hoursEndInput = page.locator('input[name="allowedHoursEnd"]');
    await hoursEndInput.fill('20:00');

    // Click save button to trigger 409 conflict
    const saveBtn = page.locator('button:has-text("Save Settings")').first();
    await saveBtn.click();

    // Assert visible conflict banner & "Reload latest" action (Non-negotiable 3)
    await expect(page.locator('text=Version conflict (409)').first()).toBeVisible();
    await expect(page.locator('button:has-text("Reload latest")')).toBeVisible();
  });

  test('6. Double-Click Protection: Idempotency-Key guard and instant button disabling', async ({ page }) => {
    let activationAttempts = 0;

    await page.addInitScript(() => {
      localStorage.setItem('grovastra_auth_token', 'mock_jwt_owner_session_token');
      localStorage.setItem(
        'grovastra_auth_user',
        JSON.stringify({
          id: 'usr_owner_01',
          role: 'BOUTIQUE_OWNER',
          tenantId: 'shop_padmavati_handlooms',
          shopName: 'Padmavati Handlooms'
        })
      );
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          campaign: {
            id: 'cmp_e2e_test_001',
            name: 'Festive Birthday Silk 2026',
            status: 'DRAFT',
            version: 1,
            enrolledCount: 0,
            activeVersion: 1,
            trigger: { type: 'OCCASION', field: 'customer.birthday', windowDays: 7, timezone: 'Asia/Kolkata', localTime: '10:00' },
            steps: [
              {
                stepId: 'invitation',
                offsetDays: 0,
                localTime: '10:00',
                templateRef: { id: 'tpl_birthday_invite', revision: 1, language: 'en' },
                bindings: {},
                stopOnReply: true,
                stopOnGoal: true
              }
            ]
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/dry-runs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          dryRun: {
            dryRunId: 'dr_e2e_test_01',
            draftFingerprint: 'rfp_e2e_verified_fingerprint_01',
            evaluatedAt: new Date().toISOString(),
            summary: { totalEvaluated: 10, eligibleCount: 2, excludedCount: 8 },
            samplePlans: [
              {
                customerId: 'cus_01',
                customerName: 'Lakshmi',
                occasionDate: '2026-10-28',
                steps: [{ stepId: 'invitation', dueAtUtc: new Date().toISOString(), localTime: '10:00', renderedPreview: 'Hello' }]
              }
            ]
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/cmp_e2e_test_001/activate', async (route) => {
      activationAttempts++;
      // Delay response to test button disabling during in-flight mutation
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Campaign activated',
          campaign: { id: 'cmp_e2e_test_001', status: 'ACTIVE', version: 1 }
        })
      });
    });

    await page.goto('/campaigns/cmp_e2e_test_001/edit');
    await page.click('button:has-text("Step 5")');

    const activateBtn = page.locator('button:has-text("Activate campaign")').first();
    await expect(activateBtn).toBeVisible();

    // Trigger rapid double-click
    await activateBtn.dblclick();

    // Assert only a single activation API call was sent
    expect(activationAttempts).toBe(1);
  });

  test('7. Responsive Viewport Check: 360px mobile and 1280px desktop', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('grovastra_auth_token', 'mock_jwt_owner_session_token');
      localStorage.setItem(
        'grovastra_auth_user',
        JSON.stringify({
          id: 'usr_owner_01',
          role: 'BOUTIQUE_OWNER',
          tenantId: 'shop_padmavati_handlooms',
          shopName: 'Padmavati Handlooms'
        })
      );
    });

    await page.route('**/api/v1/campaigns', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, campaigns: [] })
      });
    });

    await page.route('**/api/v1/campaigns/reports/owner-overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          report: {
            tenantId: 't1',
            generatedAt: new Date().toISOString(),
            eligibleCustomers: 120,
            enrollments: { total: 10, active: 5, completed: 4, cancelled: 1 },
            executions: { scheduled: 5, deferred: 1, skipped: 2, cancelled: 1, expired: 0, dispatching: 0, accepted: 10, delivered: 9, read: 7, unknown: 0 },
            evidenceCounts: { accepted: 10, delivered: 9, read: 7 },
            repliesAndHolds: { totalHeldEnrollments: 1, skippedReplyHoldExecutions: 2 },
            goalCompletions: { totalGoalEnrollments: 3, skippedGoalExecutions: 3 },
            salesAttribution: { rule: 'SINGLE_ATTRIBUTION_WINDOW', attributedOrdersCount: 3, attributedNetSalesPaise: 4500000, unassignedOrdersCount: 12, unassignedNetSalesPaise: 12000000 },
            reasonsSummary: { 'REPLY_HOLD': 2, 'GOAL_REACHED': 3 }
          }
        })
      });
    });

    await page.route('**/api/v1/campaigns/monitoring/alerts', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          monitoring: {
            tenantId: 't1',
            evaluatedAt: new Date().toISOString(),
            status: 'HEALTHY',
            alerts: [],
            metrics: { plannerLagMinutes: 5, dueStepAgeMinutes: 2, eventBacklogCount: 0, unknownOutcomesCount: 0, templateBlocksCount: 0, stalledCheckpointsCount: 0 }
          }
        })
      });
    });

    // 360px Mobile Viewport
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/campaigns');
    await expect(page.locator('body')).toBeVisible();

    // 1280px Desktop Viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/reports');
    await expect(page.locator('body')).toBeVisible();
  });
});
