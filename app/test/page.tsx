import TestModule from '../components/TestModule';

async function validateSession() {
  try {
    const response = await fetch('https://ai4kingdom.com/wp-json/custom/v1/validate_session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'action=validate_session'
    });

    console.log('Response Status:', response.status);
    console.log('Response Headers:', Object.fromEntries(response.headers));
    
    const data = await response.json();
    console.log('Response Data:', data);
    
    // 检查cookie
    console.log('Current Cookies:', document.cookie);
  } catch (error) {
    console.error('Validation Error:', error);
  }
}

export default function TestPage() {
  return (
    <div>
      <TestModule />
    </div>
  );
} 