const router=require('express').Router();
const s=require('../services/auth.service');
const {wrap}=require('../utils/http');
const {requireAuth}=require('../middleware/auth');
router.post('/login',wrap(async(req,res)=>res.json({success:true,data:await s.login(req.body)})));
router.get('/me',requireAuth,wrap((req,res)=>res.json({success:true,data:req.user})));
router.post('/logout',requireAuth,wrap(async(req,res)=>{await s.logout(req.sessionToken);res.json({success:true,message:'Signed out'})}));
module.exports=router;
