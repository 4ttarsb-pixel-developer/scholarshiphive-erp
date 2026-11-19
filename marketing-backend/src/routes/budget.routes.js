const router=require('express').Router();
const s=require('../services/budget.service');
const {wrap,requireDemoMutation}=require('../utils/http');
const {adminOnly}=require('../middleware/auth');
// Every signed-in user can read ONLY their own allocations; Admin sees all employee allocations.
router.get('/my',wrap(async(req,res)=>res.json({success:true,data:await s.myAllocations(req.user,req.query.month||s.currentMonth())})));
router.get('/employee-allocations',adminOnly,wrap(async(req,res)=>res.json({success:true,data:await s.allEmployeeAllocations(req.query.month||s.currentMonth())})));
router.post('/employee-allocations',adminOnly,requireDemoMutation,wrap(async(req,res)=>res.status(201).json({success:true,data:await s.createEmployeeAllocation(req.body)})));
router.patch('/employee-allocations/:id',adminOnly,requireDemoMutation,wrap(async(req,res)=>res.json({success:true,data:await s.updateEmployeeAllocation(req.params.id,req.body)})));
router.use(adminOnly);
router.get('/',wrap(async(req,res)=>res.json({success:true,data:await s.snapshot(req.query.month||s.currentMonth())})));
router.post('/',requireDemoMutation,wrap(async(req,res)=>res.status(201).json({success:true,data:await s.create(req.body)})));
router.patch('/:id',requireDemoMutation,wrap(async(req,res)=>res.json({success:true,data:await s.update(req.params.id,req.body)})));
module.exports=router;
