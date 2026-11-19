const service=require('../services/category.service');
const { wrap }=require('../utils/http');
exports.getAll=wrap(async(req,res)=>res.json({success:true,data:await service.all()}));
exports.getById=wrap(async(req,res)=>res.json({success:true,data:await service.byId(req.params.id)}));
exports.create=wrap(async(req,res)=>res.status(201).json({success:true,data:await service.create(req.body)}));
exports.update=wrap(async(req,res)=>res.json({success:true,data:await service.update(req.params.id,req.body)}));
exports.remove=wrap(async(req,res)=>{await service.remove(req.params.id);res.json({success:true,message:'Category deleted'})});

exports.addSubcategory=wrap(async(req,res)=>res.status(201).json({success:true,data:await service.addSubcategory(req.params.id,req.body)}));
exports.removeSubcategory=wrap(async(req,res)=>{await service.removeSubcategory(req.params.id,req.params.subId);res.json({success:true,message:'Subcategory removed'})});
