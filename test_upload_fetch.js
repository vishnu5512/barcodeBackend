const form = new FormData();
form.append('files', new Blob(['dummy'], {type: 'application/pdf'}), 'dummy.pdf');

fetch('http://localhost:5000/upload', { method: 'POST', body: form })
  .then(res => res.json())
  .then(data => console.log("Success:", data))
  .catch(err => console.error("Error:", err));
