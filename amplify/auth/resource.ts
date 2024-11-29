import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: {
<<<<<<< HEAD
    email: {
      verificationEmailSubject: '验证你的邮箱',
      verificationEmailBody: (code: () => string) => `你的验证码是: ${code()}`
    },
    phone: undefined
=======
    email: true
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04
  }
});
