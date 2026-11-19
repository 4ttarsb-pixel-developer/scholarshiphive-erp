const router=require('express').Router();
const s=require('../services/user.service');
const {wrap,requireDemoMutation}=require('../utils/http');
const {adminOnly}=require('../middleware/auth');
router.use(adminOnly);
router.get('/',wrap(async(req,res)=>res.json({success:true,data:await s.all()})));
router.post('/',requireDemoMutation,wrap(async(req,res)=>res.status(201).json({success:true,data:await s.create(req.body)})));
router.patch('/:id/status',requireDemoMutation,wrap(async(req,res)=>res.json({success:true,data:await s.status(req.params.id,req.body?.status,req.user.id)})));
module.exports=router;
