import { Router, type IRouter } from "express";
import consoleRouter from "./console";
import gatewayRouter from "./gateway";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(consoleRouter);
router.use(gatewayRouter);

export default router;
