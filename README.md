# BudgetBoss (Custom Fork)

A personal finance tracker based on [DumbWareio/DumbBudget](https://github.com/DumbWareio/DumbBudget), with key improvements for multi-account and dashboard-based financial insights.

## Overview

This is a fork of the original **DumbBudget** project, extended with new features to better organize and visualize your finances. In addition to the original functionality, this version introduces:

### ✅ New Features Added

* 🏦 **Account Management**: Create and manage multiple accounts and credit cards.
* 🔗 **Linked Transactions**: Associate each income/expense with a specific account.
* 🧠 **Custom Categories**: Define your own spending categories with persistent storage.
* 📈 **Dashboard**: Visual insights with charts for:

  * Income vs Expenses
  * Spending by Category
  * Financial Trends over Time

### 🔄 Features from the Original Project

* 🔒 PIN-protected access
* 📊 Real-time balance calculations
* 📅 Date range filtering
* 🔍 Transaction filtering and sorting
* 🌓 Light/Dark mode
* 📤 Export to CSV
* 💱 Multi-currency support
* 🌐 PWA support

## Getting Started

### Docker Quickstart

```bash
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/data:/app/data \
  -e BUDGETBOSS_PIN=12345 \
  -e CURRENCY=USD \
  -e BASE_URL=http://localhost:3000 \
  -e SITE_TITLE='My Account' \
  maranguapo/budgetboss:latest
```

### Environment Variables

| Variable         | Description                    | Required | Default                                        |
| ---------------- | ------------------------------ | -------- | ---------------------------------------------- |
| `BUDGETBOSS_PIN` | PIN code to access the app     | Yes      | -                                              |
| `CURRENCY`       | Currency code for transactions | No       | USD                                            |
| `BASE_URL`       | Base URL of the app            | No       | [http://localhost:3000](http://localhost:3000) |
| `SITE_TITLE`     | Title shown on the app         | No       | BudgetBoss                                     |
| `INSTANCE_NAME`  | Name of the specific instance  | No       | -                                              |

### Development

```bash
git clone https://github.com/maranguapo/BudgetBoss.git
cd BudgetBoss
npm install
npm run dev
```

## Credits

* Original project by [DumbWareio](https://github.com/DumbWareio/DumbBudget)
* Fork and enhancements by [Maranguapo](https://github.com/maranguapo)

## License

MIT

---

Built with ❤️ on top of a great open source foundation.
