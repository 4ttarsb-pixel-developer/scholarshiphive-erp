const express=require('express');
const cors=require('cors');
const helmet=require('helmet');
const {HttpError,wrap}=require('./utils/http');
const dashboard=require('./services/dashboard.service');
const budgetService=require('./services/budget.service');
const {requireAuth,adminOnly}=require('./middleware/auth');
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const app=express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({origin:(process.env.CORS_ORIGIN||'http://localhost:5173,http://localhost:5174,http://localhost:5175').split(',')}));
app.use(express.json({limit:'4mb'}));
app.get('/api/v1/health',wrap(async(req,res)=>{
  const base={success:true,message:'Scholarshiphive MEA API is running'};
  if(!IS_PG)return res.json({...base,database:'not-connected',db_connected:false,mode:'mock'});
  try{
    const ok=await require('./db/pool').healthCheck();
    return res.json({...base,database:ok?'connected':'error',db_connected:!!ok,mode:'postgres'});
  }catch{
    return res.status(503).json({success:false,message:'Database unavailable',database:'error',db_connected:false,mode:'postgres'});
  }
}));
app.use('/api/v1/auth',require('./routes/auth.routes'));
app.use('/api/v1',requireAuth);
app.use('/api/v1/categories',require('./routes/category.routes'));
app.use('/api/v1/expenses',require('./routes/expense.routes'));
app.use('/api/v1/budgets',require('./routes/budget.routes'));
app.use('/api/v1/audit',require('./routes/audit.routes'));
app.use('/api/v1/users',require('./routes/user.routes'));
app.use('/api/v1/ad-accounts',require('./routes/ad-account.routes'));
app.use('/api/v1/ad-integrations',require('./routes/ad-integration.routes'));
app.use('/api/v1/fx',require('./routes/fx.routes'));
app.use('/api/v1/attribution',require('./routes/attribution.routes'));
app.get('/api/v1/dashboard/summary',wrap(async(req,res)=>res.json({success:true,data:await dashboard.summaryForUser(req.user,req.query.month||budgetService.currentMonth(),req.query)})));
app.get('/api/v1/reports/overview',adminOnly,wrap(async(req,res)=>res.json({success:true,data:await dashboard.report(req.query)})));
app.use('/api',(req,res)=>res.status(404).json({success:false,message:'API route not found'}));
app.use((err,req,res,next)=>{
  if(err.type==='entity.too.large')return res.status(413).json({success:false,message:'Upload exceeds 2 MB document limit'});
  if(err instanceof SyntaxError && err.status===400 && 'body' in err)return res.status(400).json({success:false,message:'Invalid JSON body'});
  if (IS_PG && ['P0001','23505','23503','23514','23P01'].includes(err.code)) {
    return res.status(409).json({success:false,message:err.code==='P0001' ? err.message : 'Database constraint prevents this operation'});
  }
  if(!(err instanceof HttpError)) console.error('Unexpected API error:',err);
  return res.status(err.status||500).json({success:false,message:err instanceof HttpError?err.message:'Internal server error'});
});
module.exports=app;
