const router=require('express').Router();
const {adminOnly}=require('../middleware/auth');
const {wrap,requireDemoMutation}=require('../utils/http');
const fx=require('../services/fx.service');
router.get('/rates',wrap(async(req,res)=>res.json({success:true,data:await fx.rows()})));
router.post('/rates',adminOnly,requireDemoMutation,wrap(async(req,res)=>res.status(201).json({success:true,data:await fx.set(req.body,req.user)})));
module.exports=router;
