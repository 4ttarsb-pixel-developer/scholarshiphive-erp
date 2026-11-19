const router=require('express').Router();
const s=require('../services/audit.service');
const {wrap,requireDemoMutation}=require('../utils/http');
const {adminOnly}=require('../middleware/auth');
router.use(adminOnly);
router.get('/queue',wrap(async(req,res)=>res.json({success:true,data:await s.queue()})));
router.get('/history',wrap(async(req,res)=>res.json({success:true,data:await s.history(req.query.expenseId)})));
router.post('/:expenseId/decision',requireDemoMutation,wrap(async(req,res)=>res.json({success:true,data:await s.decide(req.params.expenseId,req.body,req.user)})));
module.exports=router;
