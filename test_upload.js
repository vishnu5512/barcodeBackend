const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const form = new FormData();
form.append('files', Buffer.from('dummy pdf content'), { filename: 'dummy.pdf', contentType: 'application/pdf' });

axios.post('http://localhost:5000/upload', form, {
  headers: form.getHeaders(),
}).then(res => console.log("Success:", res.data))
  .catch(err => console.error("Error:", err.message));
