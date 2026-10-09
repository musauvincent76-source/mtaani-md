const express=require('express');
const {spawn}=require('child_process');
const app=express();
app.use(express.json());
app.use(express.static(__dirname));
app.get('/',(req,res)=>res.sendFile(__dirname+'/index.html'));
app.post('/pair',(req,res)=>{
  const {number}=req.body;
  if(!number||!number.startsWith('254')) return res.json({code:'START WITH 254'});
  res.json({code:'MT-'+Math.random().toString(36).slice(2,6).toUpperCase()});
});
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>{console.log('Site on',PORT);spawn('node',['index.js'],{stdio:'inherit'});});
