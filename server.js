const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"]
    } 
});

app.use(cors());
app.use(express.json());

// ✅ ГЛАВНАЯ СТРАНИЦА (встроенный HTML)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>🚀 My Telegram</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:system-ui;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);height:100vh;display:flex;align-items:center;justify-content:center;color:#333}
        #app{max-width:400px;width:90%;background:white;border-radius:20px;padding:40px;box-shadow:0 20px 40px rgba(0,0,0,0.1)}
        h1{font-size:2em;color:#0088cc;margin-bottom:30px;text-align:center}
        input{width:100%;padding:15px;margin:10px 0;border:1px solid #ddd;border-radius:10px;font-size:16px;box-sizing:border-box}
        button{width:100%;padding:15px;background:#0088cc;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;margin:5px

