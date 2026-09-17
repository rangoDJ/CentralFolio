import { Router } from "express";
import { listOrdersHandler, cancelOrderHandler } from "../controllers/orderController.js";
import { validateBody } from "../middleware/validate.js";
import { cancelOrderSchema } from "../schemas/orderSchema.js";

const router = Router();

// Read live from the brokerage — order status is only useful when current.
router.get("/orders", listOrdersHandler);
router.post("/orders/cancel", validateBody(cancelOrderSchema), cancelOrderHandler);

export default router;
