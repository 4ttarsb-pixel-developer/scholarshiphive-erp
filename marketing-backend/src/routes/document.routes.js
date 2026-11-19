const router=require('express').Router({mergeParams:true});
const docs=require('../services/document.service');
const {wrap,requireDemoMutation}=require('../utils/http');
router.get('/',wrap(async(req,res)=>res.json({success:true,data:await docs.list(req.params.id,req.user),required:3})));
router.post('/',requireDemoMutation,wrap(async(req,res)=>res.status(201).json({success:true,data:await docs.upload(req.params.id,req.user,req.body)})));
router.get('/:slot/download',wrap(async(req,res)=>{
  const d=await docs.get(req.params.id,req.params.slot,req.user);
  res.set('Content-Type',d.mimeType);
  res.set('Content-Length',String(d.bytes.length));
  res.set('Content-Disposition',`attachment; filename="document-${d.slot}.${d.mimeType==='application/pdf'?'pdf':d.mimeType==='image/png'?'png':'jpg'}"`);
  res.set('X-Content-Type-Options','nosniff');
  res.set('Cache-Control','no-store');
  return res.send(d.bytes);
}));
router.delete('/:slot',requireDemoMutation,wrap(async(req,res)=>{await docs.remove(req.params.id,req.params.slot,req.user);res.json({success:true,message:'Document removed'})}));
module.exports=router;
