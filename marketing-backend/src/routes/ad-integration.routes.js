const router=require('express').Router();
const {wrap,requireDemoMutation}=require('../utils/http');
const {adminOnly}=require('../middleware/auth');
const service=require('../services/ad-integration.service');
router.get('/:id/status',wrap(async(req,res)=>{
 const result=await service.status(req.params.id,req.user,req.query);
 if((process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres'){
  const state=await require('../jobs/ad-sync.queue').accountSyncState(req.params.id);
  result.syncInProgress=state.inProgress;
  if(state.inProgress)result.integrationStatus='Syncing';
 }
 res.json({success:true,data:result});
}));
router.get('/:id/campaigns',wrap(async(req,res)=>res.json({success:true,data:await service.campaigns(req.params.id,req.user,req.query)})));
router.get('/:id/ad-groups',wrap(async(req,res)=>res.json({success:true,data:await service.adGroups(req.params.id,req.user,req.query.campaignId,req.query)})));
router.get('/:id/ads',wrap(async(req,res)=>res.json({success:true,data:await service.ads(req.params.id,req.user,req.query)})));
router.get('/:id/ads/:adId',wrap(async(req,res)=>res.json({success:true,data:await service.adDetail(req.params.id,req.params.adId,req.user,req.query)})));
router.get('/:id/hierarchy',wrap(async(req,res)=>res.json({success:true,data:await service.hierarchy(req.params.id,req.user,req.query)})));
router.get('/:id/performance',wrap(async(req,res)=>res.json({success:true,data:await service.performance(req.params.id,req.user,req.query)})));
router.post('/:id/verify',adminOnly,requireDemoMutation,wrap(async(req,res)=>res.json({success:true,data:await service.verify(req.params.id,req.user)})));
router.post('/:id/refresh',requireDemoMutation,wrap(async(req,res)=>res.status(202).json({success:true,data:await service.enqueue(req.params.id,req.user,{force:true,...req.body})})));
module.exports=router;
