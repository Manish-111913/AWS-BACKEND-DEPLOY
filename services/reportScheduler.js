const cron = require('node-cron');
const { pool } = require('../config/database');

class ReportScheduler {
  constructor() {
    this.jobs = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) return;
    
    console.log('🕐 Initializing Report Scheduler...');
    
    // Schedule daily end-of-day report notifications (11:30 PM)
    this.scheduleEndOfDayReports();
    
    // Schedule daily missing report reminders (9:00 AM)
    this.scheduleMissingReportReminders();
    
    // Schedule monthly report generation (1st day of month at 10:00 AM)
    this.scheduleMonthlyReports();
    
    // Schedule performance anomaly checks (hourly during business hours)
    this.schedulePerformanceChecks();

  // Schedule nightly reorder point refresh (2:00 AM IST)
  this.scheduleReorderPointRefresh();
    
    this.isInitialized = true;
    console.log('✅ Report Scheduler initialized successfully');
  }

  scheduleEndOfDayReports() {
    // Every day at 11:30 PM (after restaurant closes)
    const job = cron.schedule('30 23 * * *', async () => {
      console.log('🌅 Running end-of-day report generation...');
      await this.generateEndOfDayReports();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });
    
    this.jobs.set('eod-reports', job);
    job.start();
    console.log('📅 Scheduled: End-of-day reports at 11:30 PM daily');
  }

  scheduleMissingReportReminders() {
    // Every day at 9:00 AM (start of business day)
    const job = cron.schedule('0 9 * * *', async () => {
      console.log('⏰ Checking for missing daily reports...');
      await this.checkMissingReports();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });
    
    this.jobs.set('missing-reports', job);
    job.start();
    console.log('📅 Scheduled: Missing report reminders at 9:00 AM daily');
  }

  scheduleMonthlyReports() {
    // 1st day of every month at 10:00 AM (business planning time)
    const job = cron.schedule('0 10 1 * *', async () => {
      console.log('📊 Generating monthly reports...');
      await this.generateMonthlyReports();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });
    
    this.jobs.set('monthly-reports', job);
    job.start();
    console.log('📅 Scheduled: Monthly reports on 1st of month at 10:00 AM');
  }

  schedulePerformanceChecks() {
    // Every 2 hours during business hours (10 AM to 10 PM)
    const job = cron.schedule('0 10-22/2 * * *', async () => {
      console.log('📈 Running performance anomaly checks...');
      await this.checkPerformanceAnomalies();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });
    
    this.jobs.set('performance-checks', job);
    job.start();
    console.log('📅 Scheduled: Performance checks every 2 hours (10 AM - 10 PM)');
  }

  scheduleReorderPointRefresh() {
    // Every day at 2:00 AM IST
    const job = cron.schedule('0 2 * * *', async () => {
      console.log('🔁 Nightly: refreshing dynamic reorder points…');
      await this.refreshReorderPoints();
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata'
    });

    this.jobs.set('reorder-point-refresh', job);
    job.start();
    console.log('📅 Scheduled: Reorder point refresh at 2:00 AM daily');
  }

  async refreshReorderPoints() {
    const client = await pool.connect();
    try {
      // Update auto-calculated reorder_point for items without a manual override
      // ROP = CEIL(ADC * LeadTime + SafetyStock)
      // LeadTime preference: vendor-specific (default vendor) → item average → fallback 7 days
      const sql = `
        WITH params AS (
          SELECT 7::numeric AS default_lead
        )
        UPDATE InventoryItems ii
        SET 
          reorder_point = GREATEST(1, CEIL(
            COALESCE(rpc.average_daily_consumption, 0) *
            COALESCE(vlt.avg_lead_time_days, rpc.average_lead_time_days, (SELECT default_lead FROM params))
            + COALESCE(ii.safety_stock, 0)
          )),
          updated_at = NOW()
        FROM ReorderPointCalculations rpc
        LEFT JOIN VendorLeadTimes vlt 
          ON vlt.item_id = ii.item_id AND vlt.vendor_id = ii.default_vendor_id
        WHERE ii.item_id = rpc.item_id
          AND ii.business_id = rpc.business_id
          AND ii.is_active = TRUE
          AND ii.manual_reorder_point IS NULL
      `;
      const res = await client.query(sql);
      console.log(`✅ Reorder points refreshed. Rows affected: ${res.rowCount}`);
    } catch (error) {
      console.error('❌ Error refreshing reorder points:', error);
    } finally {
      client.release();
    }
  }

  async generateEndOfDayReports() {
    const client = await pool.connect();
    try {
      // Get all active businesses and users with EOD report notifications enabled
      const users = await client.query(`
        SELECT DISTINCT u.user_id, u.business_id, b.name AS business_name
        FROM Users u
        JOIN Businesses b ON u.business_id = b.business_id
        LEFT JOIN NotificationPreferences np ON u.user_id = np.user_id AND np.alert_type = 'endOfDayReports'
        WHERE u.is_active = true 
        AND (np.is_enabled IS NULL OR np.is_enabled = true)
      `);

      const today = new Date().toISOString().slice(0, 10);
      
      for (const user of users.rows) {
        try {
          // Call the notification API endpoint
          await this.callNotificationEndpoint('/reports/eod-summary', {
            businessId: user.business_id,
            userId: user.user_id,
            date: today
          });
          
          console.log(`✅ EOD report sent to user ${user.user_id} in business ${user.business_name}`);
        } catch (error) {
          console.error(`❌ Failed to send EOD report to user ${user.user_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error in generateEndOfDayReports:', error);
    } finally {
      client.release();
    }
  }

  async checkMissingReports() {
    const client = await pool.connect();
    try {
      // Get all active users with daily report reminders enabled
      const users = await client.query(`
        SELECT DISTINCT u.user_id, u.business_id, b.name AS business_name
        FROM Users u
        JOIN Businesses b ON u.business_id = b.business_id
        LEFT JOIN NotificationPreferences np ON u.user_id = np.user_id AND np.alert_type = 'dailyReportReminders'
        WHERE u.is_active = true 
        AND (np.is_enabled IS NULL OR np.is_enabled = true)
      `);

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().slice(0, 10);
      
      for (const user of users.rows) {
        try {
          // Call the notification API endpoint
          await this.callNotificationEndpoint('/reports/missing-daily-report', {
            businessId: user.business_id,
            userId: user.user_id,
            date: dateStr
          });
          
          console.log(`✅ Missing report check completed for user ${user.user_id}`);
        } catch (error) {
          console.error(`❌ Failed to check missing reports for user ${user.user_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error in checkMissingReports:', error);
    } finally {
      client.release();
    }
  }

  async generateMonthlyReports() {
    const client = await pool.connect();
    try {
      // Get all active users with monthly reports enabled
      const users = await client.query(`
        SELECT DISTINCT u.user_id, u.business_id, b.name AS business_name
        FROM Users u
        JOIN Businesses b ON u.business_id = b.business_id
        LEFT JOIN NotificationPreferences np ON u.user_id = np.user_id AND np.alert_type = 'monthlyReports'
        WHERE u.is_active = true 
        AND (np.is_enabled IS NULL OR np.is_enabled = true)
      `);

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      const monthStr = lastMonth.toISOString().slice(0, 7); // YYYY-MM format
      
      for (const user of users.rows) {
        try {
          // Call the notification API endpoint
          await this.callNotificationEndpoint('/reports/monthly-ready', {
            businessId: user.business_id,
            userId: user.user_id,
            month: monthStr
          });
          
          console.log(`✅ Monthly report sent to user ${user.user_id} for ${monthStr}`);
        } catch (error) {
          console.error(`❌ Failed to send monthly report to user ${user.user_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error in generateMonthlyReports:', error);
    } finally {
      client.release();
    }
  }

  async checkPerformanceAnomalies() {
    const client = await pool.connect();
    try {
      // Get all active users with performance alerts enabled
      const users = await client.query(`
        SELECT DISTINCT u.user_id, u.business_id, b.name AS business_name
        FROM Users u
        JOIN Businesses b ON u.business_id = b.business_id
        LEFT JOIN NotificationPreferences np ON u.user_id = np.user_id AND np.alert_type = 'performanceAlerts'
        WHERE u.is_active = true 
        AND (np.is_enabled IS NULL OR np.is_enabled = true)
      `);

      const today = new Date().toISOString().slice(0, 10);
      
      for (const user of users.rows) {
        try {
          // Check for unusual sales volume
          await this.checkUnusualSalesVolume(user.business_id, user.user_id, today);
          
          // Check for high wastage trends
          await this.checkWastageTrends(user.business_id, user.user_id);
          
          console.log(`✅ Performance check completed for user ${user.user_id}`);
        } catch (error) {
          console.error(`❌ Failed performance check for user ${user.user_id}:`, error.message);
        }
      }
    } catch (error) {
      console.error('❌ Error in checkPerformanceAnomalies:', error);
    } finally {
      client.release();
    }
  }

  async checkUnusualSalesVolume(businessId, userId, date) {
    // This would contain logic to analyze sales patterns and detect anomalies
    // For now, we'll implement a basic version that checks against recent averages
    
    const client = await pool.connect();
    try {
      // Get today's sales volume
      const todayQuery = await client.query(`
        SELECT COUNT(*) as order_count, COALESCE(SUM(total_amount), 0) as total_sales
        FROM SalesTransactions st
        WHERE st.business_id = $1 
        AND DATE(st.transaction_date) = $2
      `, [businessId, date]);

      if (todayQuery.rows.length === 0) return;

      const todayData = todayQuery.rows[0];
      const todayVolume = parseInt(todayData.order_count);
      const todaySales = parseFloat(todayData.total_sales);

      // Get average from last 7 days (excluding today)
      const avgQuery = await client.query(`
        SELECT AVG(daily_orders) as avg_orders, AVG(daily_sales) as avg_sales
        FROM (
          SELECT DATE(transaction_date) as date, 
                 COUNT(*) as daily_orders,
                 SUM(total_amount) as daily_sales
          FROM SalesTransactions
          WHERE business_id = $1 
          AND DATE(transaction_date) >= $2::date - INTERVAL '7 days'
          AND DATE(transaction_date) < $2::date
          GROUP BY DATE(transaction_date)
        ) daily_stats
      `, [businessId, date]);

      if (avgQuery.rows.length === 0 || !avgQuery.rows[0].avg_orders) return;

      const avgOrders = parseFloat(avgQuery.rows[0].avg_orders);
      const avgSales = parseFloat(avgQuery.rows[0].avg_sales);

      // Check if today's volume is significantly different (>30% deviation)
      const orderDeviation = Math.abs((todayVolume - avgOrders) / avgOrders) * 100;
      const salesDeviation = Math.abs((todaySales - avgSales) / avgSales) * 100;

      if (orderDeviation > 30 || salesDeviation > 30) {
        const isHigh = todayVolume > avgOrders || todaySales > avgSales;
        const percentage = Math.max(orderDeviation, salesDeviation).toFixed(1);
        
        await this.callNotificationEndpoint('/usage/unusual-sales', {
          businessId,
          userId,
          date,
          isHigh,
          percentage: `${percentage}%`,
          averageVolume: Math.round(avgOrders)
        });
      }
    } catch (error) {
      console.error('❌ Error checking unusual sales volume:', error);
    } finally {
      client.release();
    }
  }

  async checkWastageTrends(businessId, userId) {
    try {
      // Check for wastage trends over the last 7 days
      await this.callNotificationEndpoint('/reports/high-wastage-trend', {
        businessId,
        userId,
        days: 7
      });
    } catch (error) {
      console.error('❌ Error checking wastage trends:', error);
    }
  }

  async callNotificationEndpoint(endpoint, data) {
    try {
  const axios = require('axios');
  const baseURL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;
      
      const response = await axios.post(`${baseURL}/api/notifications${endpoint}`, data, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          // Help tenantContext resolve business for this call without relying on defaults
          ...(data && data.businessId ? { 'X-Business-Id': String(data.businessId) } : {})
        }
      });
      
      return response.data;
    } catch (error) {
      // Don't throw error for skipped notifications (duplicates)
      if (error.response?.data?.skipped) {
        return error.response.data;
      }
      
      // Log error but don't crash the scheduler
      console.error(`❌ Error calling ${endpoint}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  stop() {
    console.log('🛑 Stopping Report Scheduler...');
    for (const [name, job] of this.jobs) {
      try {
        if (typeof job.stop === 'function') {
          job.stop();
        }
      } catch (e) {
        console.warn(`⚠️ Could not stop job ${name}:`, e.message);
      }
      console.log(`⏹️ Stopped job: ${name}`);
    }
    this.jobs.clear();
    this.isInitialized = false;
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      activeJobs: Array.from(this.jobs.keys()),
      nextRuns: Array.from(this.jobs.entries()).map(([name, job]) => ({
        name,
        nextRun: job.running ? 'Running' : 'Scheduled'
      }))
    };
  }
}

module.exports = new ReportScheduler();
