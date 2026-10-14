import dotenv from 'dotenv';
dotenv.config();

async function testSandboxConnection() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const recipientArg = process.argv[2];

  console.log('====================================================');
  console.log('GroVastra: Meta WhatsApp Cloud API Sandbox Test');
  console.log('====================================================');
  console.log('Phone Number ID:', phoneNumberId);
  console.log('Access Token Length:', accessToken ? accessToken.length : 0);

  if (!phoneNumberId || !accessToken) {
    console.error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN in .env');
    process.exit(1);
  }

  try {
    // 1. Verify Phone Number details from Meta
    console.log('\n[1/2] Verifying Sandbox Test Number with Meta Graph API...');
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('\n❌ Meta Graph API returned an error:', JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log('✅ Connection Authenticated!');
    console.log('   - Display Test Number:', data.display_phone_number);
    console.log('   - Platform Type:', data.platform_type);
    console.log('   - Quality Rating:', data.quality_rating);

    // 2. If a recipient phone is provided, send the official Meta "hello_world" test template
    if (recipientArg) {
      const cleanPhone = recipientArg.replace(/[^0-9]/g, '');
      console.log(`\n[2/2] Sending live test message to whitelisted number: +${cleanPhone}...`);

      const sendRes = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: {
            name: 'hello_world',
            language: { code: 'en_US' }
          }
        })
      });

      const sendData = await sendRes.json();

      if (sendRes.ok) {
        console.log('\n🎉 SUCCESS! Test message sent to your WhatsApp!');
        console.log('   - Message ID (wamid):', sendData.messages?.[0]?.id);
        console.log('👉 Check your WhatsApp app on your phone right now!');
      } else {
        console.error('\n❌ Send Failed. Meta returned:', JSON.stringify(sendData, null, 2));
        if (sendData.error?.message?.includes('not in the recipient list')) {
          console.log('\n💡 Hint: Make sure you added and verified this number in "Manage phone number list" on developers.facebook.com!');
        }
      }
    } else {
      console.log('\n💡 To send a live test message to your phone, run:');
      console.log('   npx tsx src/scripts/smokeTestSandbox.ts <your_mobile_number_with_country_code>');
      console.log('   Example: npx tsx src/scripts/smokeTestSandbox.ts 919876543210');
    }
  } catch (err: any) {
    console.error('Network Error:', err.message);
  }
}

testSandboxConnection();
