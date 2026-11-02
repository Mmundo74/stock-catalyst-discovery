// Brevo API transport. The API key is read only from BREVO_API_KEY.
export async function sendBrevoTest({apiKey,fromEmail,toEmail}) {
  if (!apiKey || !fromEmail || toEmail !== 'warriorniner74@gmail.com') throw new Error('missing_config');
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method:'POST',headers:{'api-key':apiKey,'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({sender:{email:fromEmail},to:[{email:toEmail}],subject:'[STOCK-CATALYST] BREVO API TEST',textContent:'Delivery test only. This is not a stock signal.'})
  });
  if (!response.ok) throw new Error('brevo_http_' + response.status);
  console.log(JSON.stringify({status:'brevo_accepted',http:response.status}));
}
if (process.argv[1]?.endsWith('brevo_api_test.mjs')) {
  sendBrevoTest({apiKey:process.env.BREVO_API_KEY,fromEmail:process.env.BREVO_SENDER_EMAIL,toEmail:'warriorniner74@gmail.com'}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
