import { Request, Response } from "express";
import { listAllUsersAcrossPortfolios, deleteUserFromPortfolios } from "../services/snaptrade.js";

export const listUsers = async (req: Request, res: Response) => {
  try {
    const users = await listAllUsersAcrossPortfolios();
    res.json(users);
  } catch (err: any) {
    const detail = err.message || err;
    res.status(500).json({ error: "Failed to list users", detail });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    await deleteUserFromPortfolios(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete user", detail: err.message });
  }
};

export const wipeAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await listAllUsersAcrossPortfolios();
    console.log(`Wiping ${users.length} unique users...`);
    
    const results = {
      success: [] as string[],
      failed: [] as { userId: string, error: any }[]
    };

    for (const userId of users) {
      try {
        await deleteUserFromPortfolios(userId);
        results.success.push(userId);
      } catch (e: any) {
        results.failed.push({ userId, error: e.message || e });
      }
    }
    
    res.json({ 
      success: true, 
      wipedCount: results.success.length,
      failedCount: results.failed.length,
      details: results
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to initiate wipe", detail: err.message });
  }
};
