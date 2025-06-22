import { ToastManager } from "./managers/toast";
const toastManager = new ToastManager(document.getElementById('toast-container'));

// Global variables
let currentTransactionType = 'income'; // Default transaction type
let currentFilter = null; // null = show all, 'income' = only income, 'expense' = only expenses
let editingTransactionId = null;
let currentSortField = 'date';
let currentSortDirection = 'desc';
let accountMap = {};

// Theme toggle functionality
function getBaseUrl() {
    // First try to get it from the server-provided meta tag
    const metaBaseUrl = document.querySelector('meta[name="base-url"]')?.content;
    if (metaBaseUrl) return metaBaseUrl;
    
    // Fallback to window.location.origin
    return window.location.origin;
}

function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}


function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Set initial theme based on system preference
    if (localStorage.getItem('theme') === null) {
        document.documentElement.setAttribute('data-theme', prefersDark.matches ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', localStorage.getItem('theme'));
    }

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        document.documentElement.style.setProperty('--is-dark', newTheme === 'dark' ? '1' : '0');
        localStorage.setItem('theme', newTheme);

        if (window.dashboardData) {
            updateDashboardUI(window.dashboardData);
        }
    });
}

// Debug logging
function debugLog(...args) {
    if (window.appConfig?.debug) {
        console.log('[DEBUG]', ...args);
    }
}

// Helper function to join paths with base path
function joinPath(path) {
    const basePath = window.appConfig?.basePath || '';
    debugLog('joinPath input:', path);
    debugLog('basePath:', basePath);
    
    // If path starts with http(s), return as is
    if (path.match(/^https?:\/\//)) {
        debugLog('Absolute URL detected, returning as is:', path);
        return path;
    }
    
    // Remove any leading slash from path and trailing slash from basePath
    const cleanPath = path.replace(/^\/+/, '');
    const cleanBase = basePath.replace(/\/+$/, '');
    
    // Join with single slash
    const result = cleanBase ? `${cleanBase}/${cleanPath}` : cleanPath;
    debugLog('joinPath result:', result);
    return result;
}

// Fetch config with instance name
async function updateInstanceName() {
    try {
        const res = await fetch(joinPath('api/config'), fetchConfig);
        const data = await res.json();
        document.title = data.instanceName;
        document.getElementById('instance-name').textContent = data.instanceName;
    } catch (error) {
        console.error('Error fetching instance name, falling back to default. Error: ', error);
        document.title = 'BudgetBoss';
        document.getElementById('instance-name').textContent = 'BudgetBoss';
    }
}

// PIN input functionality
function setupPinInputs() {
    const form = document.getElementById('pinForm');
    if (!form) return; // Only run on login page

    debugLog('Setting up PIN inputs');
    // Fetch PIN length from server

    fetch(joinPath('pin-length'))

        .then(response => response.json())
        .then(data => {
            const pinLength = data.length;
            debugLog('PIN length:', pinLength);
            const container = document.querySelector('.pin-input-container');
            
            // Create PIN input fields
            for (let i = 0; i < pinLength; i++) {
                const input = document.createElement('input');
                input.type = 'password';
                input.maxLength = 1;
                input.className = 'pin-input';
                input.setAttribute('inputmode', 'numeric');
                input.pattern = '[0-9]*';
                input.setAttribute('autocomplete', 'off');
                container.appendChild(input);
            }

            // Handle input behavior
            const inputs = container.querySelectorAll('.pin-input');
            
            // Focus first input immediately
            if (inputs.length > 0) {
                inputs[0].focus();
            }

            inputs.forEach((input, index) => {
                input.addEventListener('input', (e) => {
                    // Only allow numbers
                    e.target.value = e.target.value.replace(/[^0-9]/g, '');
                    
                    if (e.target.value) {
                        e.target.classList.add('has-value');
                        if (index < inputs.length - 1) {
                            inputs[index + 1].focus();
                        } else {
                            // Last digit entered, submit the form
                            const pin = Array.from(inputs).map(input => input.value).join('');
                            submitPin(pin, inputs);
                        }
                    } else {
                        e.target.classList.remove('has-value');
                    }
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && !e.target.value && index > 0) {
                        inputs[index - 1].focus();
                    }
                });

                // Prevent paste of multiple characters
                input.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pastedData = e.clipboardData.getData('text');
                    const numbers = pastedData.match(/\d/g);
                    
                    if (numbers) {
                        numbers.forEach((num, i) => {
                            if (inputs[index + i]) {
                                inputs[index + i].value = num;
                                inputs[index + i].classList.add('has-value');
                                if (index + i + 1 < inputs.length) {
                                    inputs[index + i + 1].focus();
                                } else {
                                    // If paste fills all inputs, submit the form
                                    const pin = Array.from(inputs).map(input => input.value).join('');
                                    submitPin(pin, inputs);
                                }
                            }
                        });
                    }
                });
            });
        });
}

// Handle PIN submission with debug logging
function submitPin(pin, inputs) {
    debugLog('Submitting PIN');
    const errorElement = document.querySelector('.pin-error');
    

    fetch(joinPath('verify-pin'), {

        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin })
    })
    .then(async response => {
        const data = await response.json();
        debugLog('PIN verification response:', response.status);
        
        if (response.ok) {
            debugLog('PIN verified, redirecting to home');
            window.location.pathname = joinPath('/');
        } else if (response.status === 429) {
            debugLog('Account locked out');
            // Handle lockout
            errorElement.textContent = data.error;
            errorElement.setAttribute('aria-hidden', 'false');
            inputs.forEach(input => {
                input.value = '';
                input.classList.remove('has-value');
                input.disabled = true;
            });
        } else {
            // Handle invalid PIN
            const message = data.attemptsLeft > 0 
                ? `Incorrect PIN. ${data.attemptsLeft} attempts remaining.` 
                : 'Incorrect PIN. Last attempt before lockout.';
            
            errorElement.textContent = message;
            errorElement.setAttribute('aria-hidden', 'false');
            inputs.forEach(input => {
                input.value = '';
                input.classList.remove('has-value');
            });
            inputs[0].focus();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        debugLog('PIN verification error:', error);
        errorElement.textContent = 'An error occurred. Please try again.';
        errorElement.setAttribute('aria-hidden', 'false');
    });
}

// Supported currencies list
const SUPPORTED_CURRENCIES = {
    KWD: { locale: 'ar-KW', symbol: 'د.ك' },
    USD: { locale: 'en-US', symbol: '$' },
    EUR: { locale: 'de-DE', symbol: '€' },
    GBP: { locale: 'en-GB', symbol: '£' },
    JPY: { locale: 'ja-JP', symbol: '¥' },
    AUD: { locale: 'en-AU', symbol: 'A$' },
    CAD: { locale: 'en-CA', symbol: 'C$' },
    CHF: { locale: 'de-CH', symbol: 'CHF' },
    CNY: { locale: 'zh-CN', symbol: '¥' },
    HKD: { locale: 'zh-HK', symbol: 'HK$' },
    NZD: { locale: 'en-NZ', symbol: 'NZ$' },
    MXN: { locale: 'es-MX', symbol: '$' },
    RUB: { locale: 'ru-RU', symbol: '₽' },
    SGD: { locale: 'en-SG', symbol: 'S$' },
    KRW: { locale: 'ko-KR', symbol: '₩' },
    INR: { locale: 'en-IN', symbol: '₹' },
    BRL: { locale: 'pt-BR', symbol: 'R$' },
    ZAR: { locale: 'en-ZA', symbol: 'R' },
    TRY: { locale: 'tr-TR', symbol: '₺' },
    PLN: { locale: 'pl-PL', symbol: 'zł' },
    SEK: { locale: 'sv-SE', symbol: 'kr' },
    NOK: { locale: 'nb-NO', symbol: 'kr' },
    DKK: { locale: 'da-DK', symbol: 'kr' },
    IDR: { locale: 'id-ID', symbol: 'Rp' },
    PHP: { locale: 'fil-PH', symbol: '₱' }
};

let currentCurrency = 'KWD'; // Default currency

// Fetch current currency from server
async function fetchCurrentCurrency() {
    try {
        debugLog('Fetching current currency');
        const response = await fetch(joinPath('api/settings/currency'), fetchConfig);
        await handleFetchResponse(response);
        const data = await response.json();
        currentCurrency = data.currency;
        debugLog('Current currency set to:', currentCurrency);
    } catch (error) {
        console.error('Error fetching currency:', error);
        debugLog('Falling back to USD');
        // Fallback to USD if there's an error
        currentCurrency = 'USD';
    }
}

// Update the formatCurrency function to use the current currency
const formatCurrency = (amount) => {
    const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.KWD;
    return new Intl.NumberFormat(currencyInfo.locale, {
        style: 'currency',
        currency: currentCurrency
    }).format(amount);
};

let currentDate = new Date();

// Shared fetch configuration with debug logging
const fetchConfig = {
    credentials: 'include',
    headers: {
        'Content-Type': 'application/json'
    }
};

// Handle session errors - only for main app, not login
async function handleFetchResponse(response) {
    debugLog('Fetch response:', response.status, response.url);
    
    // If we're already on the login page, don't redirect
    if (window.location.pathname.includes('login')) {
        return response;
    }

    // Handle unauthorized responses
    if (response.status === 401) {
        debugLog('Unauthorized, redirecting to login');
        window.location.href = joinPath('login');
        return null;
    }

    // Handle other error responses
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    if (!contentType || (!contentType.includes('application/json') && contentType.split(';')[0].trim() !== 'text/csv')) {
        debugLog('Response is not JSON or CSV, session likely expired');
        window.location.href = joinPath('login');
        return null;
    }

    return response;
}

// Update loadTransactions function
async function loadAccounts() {
    try{
        const response = await fetch(joinPath(`api/accounts`), fetchConfig);
        await handleFetchResponse(response);
        const accounts = await response.json();

        accountMap = {};
        accounts.forEach(account => {
            accountMap[account.id] = account.name;
        });
        
        const accountsList = document.getElementById('accountsList');
        if (!accountsList) return;
        accountsList.innerHTML = accounts.map(account => {
            return `
            <div class="transaction-item" data-id="${account.id}">
                <div class="transaction-content">
                    <div class="details">
                        <div class="name">${account.name}</div>
                        <div class="type">${account.type}</div>
                    </div>
                </div>
                <button class="delete-transaction" aria-label="Delete account">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
            `;
        }).join('');

        accountsList.querySelectorAll('.delete-transaction').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.closest('.transaction-item').dataset.id;
                if (confirm('Deseja deletar esta conta?')) {
                    await deleteAccount(id);
                }
            });
        });

        accountsList.querySelectorAll('.transaction-item').forEach(item => {
        item.querySelector('.transaction-content').addEventListener('click', () => {
            const id = item.dataset.id;
            const name = item.querySelector('.name').textContent;
            const type = item.querySelector('.type').textContent === 'Credit Card' ? 'creditCard' : 'account';

            document.getElementById('accountId').value = id;
            document.getElementById('name').value = name;

            document.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.type === type);
            });

            document.getElementById('accountModal').classList.add('active');
        });
    });

        
    }catch (error) {
    console.error('Error loading accounts:', error);
    debugLog('Error loading accounts:', error);
    }
}

// Update loadTransactions function
async function loadTransactions() {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const response = await fetch(joinPath(`api/transactions/range?start=${startDate}&end=${endDate}`), fetchConfig);
        await handleFetchResponse(response);
        const transactions = await response.json();
        
        const transactionsList = document.getElementById('transactionsList');
        let filteredTransactions = currentFilter 
            ? transactions.filter(t => t.type === currentFilter)
            : transactions;
            
        // Sort transactions
        filteredTransactions.sort((a, b) => {
            if (currentSortField === 'date') {
                // Use string comparison for dates to avoid timezone issues
                return currentSortDirection === 'asc' 
                    ? a.date.localeCompare(b.date) 
                    : b.date.localeCompare(a.date);
            } else {
                return currentSortDirection === 'asc' ? a.amount - b.amount : b.amount - a.amount;
            }
        });
            
        transactionsList.innerHTML = filteredTransactions.map(transaction => {
            // Split the date string and format as M/D/YYYY without timezone conversion
            const [year, month, day] = transaction.date.split('-');
            const formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
            
            const isRecurring = transaction.isRecurringInstance || transaction.recurring;
            
            return `
            <div class="transaction-item ${isRecurring ? 'recurring-instance' : ''}" data-id="${transaction.id}" data-type="${transaction.type}">
                <div class="transaction-content">
                    <div class="details">
                        <div class="description">${transaction.description}</div>
                        <div class="metadata">
                            ${transaction.category ? `<span class="category">${transaction.category}</span>` : ''}
                            ${transaction.accountId ? `<span class="account-name">${accountMap[transaction.accountId] || 'Account'}</span>` : ''}
                            <span class="date">${formattedDate}</span>
                            ${isRecurring ? `<span class="recurring-info">(Recurring)</span>` : ''}
                        </div>
                    </div>
                    <div class="transaction-amount ${transaction.type}">
                        ${transaction.type === 'expense' ? '-' : ''}${formatCurrency(transaction.amount)}
                    </div>
                </div>
                <button class="delete-transaction" aria-label="Delete transaction">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `}).join('');

        // Add click handlers for editing and deleting
        transactionsList.querySelectorAll('.transaction-item').forEach(item => {
            const deleteBtn = item.querySelector('.delete-transaction');
            const content = item.querySelector('.transaction-content');
            const isRecurring = item.classList.contains('recurring-instance');

            // Edit handler for all transactions
            content.addEventListener('click', () => {
                const id = item.dataset.id;
                const type = item.dataset.type;
                const isRecurring = item.classList.contains('recurring-instance');
                
                // For recurring instances, get the parent transaction
                let transaction = filteredTransactions.find(t => t.id === id);
                if (isRecurring) {
                    const match = id.match(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+/);
                    const parentId = match ? match[0] : id;
                    transaction = filteredTransactions.find(t => t.id === parentId) || transaction;
                }
                
                editTransaction(id, transaction, isRecurring);
            });

            // Delete handler
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = item.dataset.id;
                const isRecurring = item.classList.contains('recurring-instance');
                
                // For recurring instances, get the parent ID (the UUID part before the timestamp)
                const transactionId = isRecurring ? id.match(/^[^-]+-[^-]+-[^-]+-[^-]+-[^-]+/)[0] : id;
                
                const message = isRecurring ? 
                    'Are you sure you want to delete this recurring transaction? This will delete ALL instances of this transaction.' :
                    'Are you sure you want to delete this transaction?';
                
                if (confirm(message)) {
                    try {
                        debugLog('Deleting transaction with ID:', transactionId);
                        const response = await fetch(joinPath(`api/transactions/${transactionId}`), {
                            ...fetchConfig,
                            method: 'DELETE'
                        });
                        await handleFetchResponse(response);
                        await loadTransactions();
                        await updateTotals();
                        toastManager.show('Transaction deleted!', 'error');
                    } catch (error) {
                        console.error('Error deleting transaction:', error);
                        toastManager.show('Failed to delete transaction. Please try again.', 'error');
                    }
                }
            });
        });
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

// Update editTransaction function
async function editTransaction(id, transaction, isRecurringInstance) {
    await populateAccountsSelect();

    // For recurring instances, always use the base transaction ID
    if (isRecurringInstance) {
        // Extract the base transaction ID (everything before the date)
        editingTransactionId = id.split('-202')[0]; // This will get the UUID part before the date
        
        // Find the original transaction to get its start date
        const startDate = transaction.recurring?.startDate || transaction.date;
        transaction = { ...transaction, date: startDate };
    } else {
        editingTransactionId = id;
    }

    const modal = document.getElementById('transactionModal');
    const form = document.getElementById('transactionForm');
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    const categoryField = document.getElementById('categoryField');
    const recurringCheckbox = document.getElementById('recurring-checkbox');
    const recurringOptions = document.getElementById('recurring-options');
    const recurringWeekday = document.getElementById('recurring-weekday');
    const recurringInterval = document.getElementById('recurring-interval');
    const recurringUnit = document.getElementById('recurring-unit');
    const dayOfMonthSelect = document.getElementById('day-of-month-select');

    // Set form values
    document.getElementById('amount').value = transaction.amount;
    document.getElementById('description').value = transaction.description;
    document.getElementById('transactionDate').value = transaction.date;
    document.getElementById('accountSelect').value = transaction.accountId || '';
    
    // Update the currentTransactionType to match the transaction being edited
    currentTransactionType = transaction.type;
    
    // Set transaction type
    toggleBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === transaction.type);
    });
    
    // Show/hide and set category for expenses
    if (transaction.type === 'expense') {
        categoryField.style.display = 'block';
        document.getElementById('category').value = transaction.category;
    } else {
        categoryField.style.display = 'none';
    }

    // Set recurring options if this is a recurring transaction
    if (transaction.recurring) {
        recurringCheckbox.checked = true;
        recurringOptions.style.display = 'block';
        
        // Parse the recurring pattern
        const pattern = transaction.recurring.pattern;
        const monthlyDayMatch = pattern.match(/every (\d+)(?:st|nd|rd|th) of the month/);
        const regularMatch = pattern.match(/every (\d+) (day|week|month|year)(?:\s+on\s+(\w+))?/);
        
        if (monthlyDayMatch) {
            recurringUnit.value = 'day of month';
            dayOfMonthSelect.value = monthlyDayMatch[1];
            dayOfMonthSelect.style.display = 'inline-block';
            recurringInterval.style.display = 'none';
            recurringWeekday.style.display = 'none';
        } else if (regularMatch) {
            const [, interval, unit, weekday] = regularMatch;
            recurringInterval.value = interval;
            recurringUnit.value = unit;
            recurringInterval.style.display = 'inline-block';
            dayOfMonthSelect.style.display = 'none';
            
            if (unit === 'week' && weekday) {
                recurringWeekday.style.display = 'inline-block';
                recurringWeekday.value = weekday;
            } else {
                recurringWeekday.style.display = 'none';
            }
        }
    } else {
        recurringCheckbox.checked = false;
        recurringOptions.style.display = 'none';
        recurringWeekday.style.display = 'none';
        recurringInterval.style.display = 'inline-block';
        dayOfMonthSelect.style.display = 'none';
    }

    // Update form submit button text
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Update';

    // Show modal
    modal.classList.add('active');
}

async function updateTotals() {
    try {
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        const response = await fetch(joinPath(`api/totals/range?start=${startDate}&end=${endDate}`), fetchConfig);
        await handleFetchResponse(response);
        const totals = await response.json();
        document.getElementById('totalIncome').textContent = formatCurrency(totals.income);
        document.getElementById('totalExpenses').textContent = formatCurrency(totals.expenses);
        const balanceElement = document.getElementById('totalBalance');
        balanceElement.textContent = formatCurrency(totals.balance);
        
        // Add appropriate class based on balance value
        balanceElement.classList.remove('positive', 'negative');
        if (totals.balance > 0) {
            balanceElement.classList.add('positive');
        } else if (totals.balance < 0) {
            balanceElement.classList.add('negative');
        }
    } catch (error) {
        console.error('Error updating totals:', error);
    }
}

// Custom Categories Management
function loadCustomCategories() {
    fetch(joinPath(`api/categories`), fetchConfig)
        .then(response => handleFetchResponse(response))
        .then(response => response.json())
        .then(categories => {
            const categorySelect = document.getElementById('category');
            const addNewOption = categorySelect.querySelector('option[value="add_new"]');
            
            // Remove existing custom categories
            Array.from(categorySelect.options).forEach(option => {
                if (option.dataset.custom === 'true') {
                    categorySelect.removeChild(option);
                }
            });
            
            // Add custom categories before the "Add Category" option
            categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                option.dataset.custom = 'true';
                categorySelect.insertBefore(option, addNewOption);
            });
        })
        .catch(error => {
            console.error('Error loading categories:', error);
            toastManager.show('Failed to load categories. Please refresh the page.', 'error');
        });
}

function saveCustomCategory(category) {
    try {
        fetch(joinPath(`api/categories`), {
            ...fetchConfig,
            method: 'POST',
            headers: {
                ...fetchConfig.headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: category })
        })
        .then(response => {
            if (!response.ok) {
                if (response.status === 409) {
                    throw new Error('Category already exists');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(() => {
            toastManager.show(`New category (${category}) added!`, 'success');
            loadCustomCategories();
        })
        .catch(error => {
            console.error('Error saving custom category:', error);
            toastManager.show(`Failed to save category: ${error.message}`, 'error');
        });
    }
    catch (error) {
        console.error('Error saving custom category:', error);
        toastManager.show('Failed to save custom category. Please try again.', 'error');
    }
}

function initCategoryHandling() {
    const categorySelect = document.getElementById('category');
    const customCategoryField = document.getElementById('customCategoryField');
    const customCategoryInput = document.getElementById('customCategory');
    const saveCategoryBtn = document.getElementById('saveCategory');
    const cancelCategoryBtn = document.getElementById('cancelCategory');

    // Load custom categories on page load
    loadCustomCategories();

    categorySelect.addEventListener('change', (e) => {
        if (e.target.value === 'add_new') {
            customCategoryField.style.display = 'block';
            categorySelect.style.display = 'none';
            customCategoryInput.focus();
        }
    });

    saveCategoryBtn.addEventListener('click', () => {
        const newCategory = customCategoryInput.value.trim();
        if (newCategory) {
            saveCustomCategory(newCategory);
            customCategoryField.style.display = 'none';
            categorySelect.style.display = 'block';
            categorySelect.value = newCategory;
            customCategoryInput.value = '';
        }
    });

    cancelCategoryBtn.addEventListener('click', () => {
        customCategoryField.style.display = 'none';
        categorySelect.style.display = 'block';
        categorySelect.value = 'Other';
        customCategoryInput.value = '';
    });

    // Handle Enter key in custom category input
    customCategoryInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveCategoryBtn.click();
        }
    });
}

function initAccountModalHandling() {
    const modal = document.getElementById('accountModal');
    // Only initialize if we're on the accounts page
    if (!modal) return;

    const addAccountBtn = document.getElementById('addAccountBtn');
    const closeModalBtn = document.querySelector('.close-modal');
    const accountForm = document.getElementById('accountForm');
    const toggleBtns = document.querySelectorAll('.account-toggle-btn');

    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    addAccountBtn.addEventListener('click', () => {
        modal.classList.add('active');
        accountForm.reset();
        document.getElementById('accountId').value = ''; // ← ESSENCIAL!
        toggleBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === 'account');
        });
    });

    closeModalBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    accountForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('accountId').value;
        const name = document.getElementById('name').value;
        const type = document.querySelector('.account-toggle-btn.active').getAttribute('data-type');

        if (id) {
            editAccount(id, name, type);
        } else {
            addAccount(name, type);
        }

        document.getElementById('accountModal').classList.remove('active');
    });

}


// Update the initTransactionModalHandling function to include category handling
function initTransactionModalHandling() {
    const modal = document.getElementById('transactionModal');
    // Only initialize if we're on the main page
    if (!modal) return;

    const addTransactionBtn = document.getElementById('addTransactionBtn');
    const closeModalBtn = document.querySelector('.close-modal');
    const transactionForm = document.getElementById('transactionForm');
    const categoryField = document.getElementById('categoryField');
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    const amountInput = document.getElementById('amount');

    // Initialize category handling
    initCategoryHandling();

    // Create and add recurring controls
    const recurringControls = createRecurringControls();
    transactionForm.appendChild(recurringControls);
    recurringControls.style.display = 'block';

    // Update amount input placeholder with current currency symbol
    function updateAmountPlaceholder() {
        const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
        amountInput.placeholder = `Amount (${currencyInfo.symbol})`;
    }

    // Open modal
    addTransactionBtn.addEventListener('click', async () => {
        await populateAccountsSelect();

        modal.classList.add('active');
        // Reset form
        transactionForm.reset();
        // Reset toggle buttons
        toggleBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === 'income');
        });
        // Hide category field for income by default
        categoryField.style.display = 'none';
        currentTransactionType = 'income';
        
        // Reset recurring options
        document.getElementById('recurring-checkbox').checked = false;
        document.getElementById('recurring-options').style.display = 'none';
        document.getElementById('recurring-weekday').style.display = 'none';
        
        // Set today's date as default
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('transactionDate').value = today;

        // Update amount placeholder with current currency
        updateAmountPlaceholder();
    });

    // Close modal
    const closeModal = () => {
        modal.classList.remove('active');
        editingTransactionId = null;
        const submitBtn = transactionForm.querySelector('button[type="submit"]');
        submitBtn.textContent = 'Add';
    };

    closeModalBtn.addEventListener('click', closeModal);

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Transaction type toggle
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            toggleBtns.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            btn.classList.add('active');
            
            currentTransactionType = btn.dataset.type;
            
            // Show/hide category field based on transaction type
            categoryField.style.display = currentTransactionType === 'expense' ? 'block' : 'none';
        });
    });

    // Update form submission
    transactionForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = {
            type: currentTransactionType,
            amount: parseFloat(document.getElementById('amount').value),
            description: document.getElementById('description').value,
            category: currentTransactionType === 'expense' ? document.getElementById('category').value : null,
            date: document.getElementById('transactionDate').value,
            recurring: buildRecurringPattern(),
            accountId: document.getElementById('accountSelect').value

        };

        try {
            const url = editingTransactionId 
                ? joinPath(`api/transactions/${editingTransactionId}`)
                : joinPath('api/transactions');
                
            const method = editingTransactionId ? 'PUT' : 'POST';

            const response = await fetch(url, {
                ...fetchConfig,
                method,
                body: JSON.stringify(formData)
            });

            await handleFetchResponse(response);
            
            // Reset editing state
            editingTransactionId = null;
            
            // Update submit button text
            const submitBtn = transactionForm.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Add';
            
            // Close modal and reset form
            closeModal();
            transactionForm.reset();
            
            // Refresh transactions list and totals
            await loadTransactions();
            await updateTotals();

            const transactionTypeMessage = currentTransactionType === 'income' ? 'Income' : 'Expense';
            toastManager.show(`${transactionTypeMessage} saved!`, 'success');
        } catch (error) {
            console.error('Error saving transaction:', error);
            toastManager.show('Failed to save transaction. Please try again.', 'error');
        }
    });
}

// Add recurring transaction UI elements
function createRecurringControls() {
    const container = document.createElement('div');
    container.className = 'recurring-controls';

    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'recurring-checkbox-wrapper';
    checkboxWrapper.style.display = 'flex';
    checkboxWrapper.style.alignItems = 'center';
    checkboxWrapper.style.gap = '0.5rem';
    checkboxWrapper.style.marginBottom = '1rem';
    checkboxWrapper.style.width = 'fit-content';
    checkboxWrapper.style.minWidth = '100px';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'recurring-checkbox';
    checkbox.style.margin = '0';

    const label = document.createElement('label');
    label.htmlFor = 'recurring-checkbox';
    label.textContent = 'Recurring';
    label.style.margin = '0';
    label.style.padding = '0';
    label.style.cursor = 'pointer';
    label.style.userSelect = 'none';

    checkboxWrapper.appendChild(checkbox);
    checkboxWrapper.appendChild(label);

    const optionsDiv = document.createElement('div');
    optionsDiv.id = 'recurring-options';
    optionsDiv.style.display = 'none';
    optionsDiv.className = 'recurring-options';

    // Interval and unit wrapper
    const intervalWrapper = document.createElement('div');
    intervalWrapper.className = 'interval-wrapper';

    // Interval input
    const intervalInput = document.createElement('input');
    intervalInput.type = 'number';
    intervalInput.id = 'recurring-interval';
    intervalInput.min = '1';
    intervalInput.defaultValue = '1';
    intervalInput.value = '1';

    // Day of month select
    const dayOfMonthSelect = document.createElement('select');
    dayOfMonthSelect.id = 'day-of-month-select';
    dayOfMonthSelect.style.display = 'none';
    // Add options for days 1-31
    for (let i = 1; i <= 31; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${i}${getDaySuffix(i)}`;
        dayOfMonthSelect.appendChild(option);
    }

    // Unit select
    const unitSelect = document.createElement('select');
    unitSelect.id = 'recurring-unit';
    const units = ['day', 'week', 'month', 'year', 'day of month'];
    units.forEach(unit => {
        const option = document.createElement('option');
        option.value = unit;
        option.textContent = unit === 'day of month' ? 'day of month' : unit + (unit === 'day' ? '' : 's');
        unitSelect.appendChild(option);
    });

    intervalWrapper.appendChild(intervalInput);
    intervalWrapper.appendChild(dayOfMonthSelect);
    intervalWrapper.appendChild(unitSelect);

    // Weekday select (for weekly recurrence)
    const weekdaySelect = document.createElement('select');
    weekdaySelect.id = 'recurring-weekday';
    weekdaySelect.style.display = 'none';
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    weekdays.forEach(day => {
        const option = document.createElement('option');
        option.value = day;
        option.textContent = day.charAt(0).toUpperCase() + day.slice(1);
        weekdaySelect.appendChild(option);
    });

    // Event listeners
    checkbox.addEventListener('change', () => {
        optionsDiv.style.display = checkbox.checked ? 'block' : 'none';
    });

    unitSelect.addEventListener('change', () => {
        weekdaySelect.style.display = unitSelect.value === 'week' ? 'inline-block' : 'none';
        intervalInput.style.display = unitSelect.value === 'day of month' ? 'none' : 'inline-block';
        dayOfMonthSelect.style.display = unitSelect.value === 'day of month' ? 'inline-block' : 'none';
    });

    // Assemble the controls
    optionsDiv.appendChild(intervalWrapper);
    optionsDiv.appendChild(weekdaySelect);

    container.appendChild(checkboxWrapper);
    container.appendChild(optionsDiv);

    return container;
}

// Function to build the recurring pattern string
function buildRecurringPattern() {
    const checkbox = document.getElementById('recurring-checkbox');
    if (!checkbox.checked) return null;

    const unit = document.getElementById('recurring-unit').value;

    if (unit === 'day of month') {
        const dayNum = document.getElementById('day-of-month-select').value;
        const suffix = getDaySuffix(dayNum);
        return {
            pattern: `every ${dayNum}${suffix} of the month`,
            until: null
        };
    }

    const interval = document.getElementById('recurring-interval').value;
    const weekday = document.getElementById('recurring-weekday').value;

    let pattern = `every ${interval} ${unit}`;
    if (unit === 'week' && weekday) {
        pattern += ` on ${weekday}`;
    }

    return {
        pattern,
        until: null
    };
}

// Helper function to get the correct suffix for a day number
function getDaySuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

async function initAccountsPage() {
    await fetchCurrentCurrency();
    const accountsContainer = document.getElementById('accountModal');
    if (!accountsContainer) return; // Only run on accounts page

    // Update currency symbols
    // const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
    // document.querySelector('.currency-sort-symbol').textContent = currencyInfo.symbol;
    // document.querySelector('.currency-symbol').textContent = currencyInfo.symbol;

    // Initial load
    await loadAccounts();
}

// Update the initMainPage function to fetch currency first
async function initMainPage() {
    await fetchCurrentCurrency();
    const mainContainer = document.getElementById('transactionModal');
    if (!mainContainer) return; // Only run on main page

    // Update currency symbols
    const currencyInfo = SUPPORTED_CURRENCIES[currentCurrency] || SUPPORTED_CURRENCIES.USD;
    document.querySelector('.currency-sort-symbol').textContent = currencyInfo.symbol;
    document.querySelector('.currency-symbol').textContent = currencyInfo.symbol;

    // Update amount placeholder when currency changes
    const amountInput = document.getElementById('amount');
    if (amountInput) {
        amountInput.placeholder = `Amount (${currencyInfo.symbol})`;
    }

    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');

    // Set initial date range to current month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    startDateInput.value = firstDay.toISOString().split('T')[0];
    endDateInput.value = lastDay.toISOString().split('T')[0];

    // Add event listeners for date changes
    startDateInput.addEventListener('change', () => {
        if (startDateInput.value > endDateInput.value) {
            endDateInput.value = startDateInput.value;
        }
        loadTransactions();
        updateTotals();
    });

    endDateInput.addEventListener('change', () => {
        if (endDateInput.value < startDateInput.value) {
            startDateInput.value = endDateInput.value;
        }
        loadTransactions();
        updateTotals();
    });

    // Export to CSV
    document.getElementById('exportBtn').addEventListener('click', async () => {
        try {
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            const response = await fetch(joinPath(`api/export/range?start=${startDate}&end=${endDate}`), {
                ...fetchConfig,
                method: 'GET'
            });
            
            // Use the same response handler as other requests
            const handledResponse = await handleFetchResponse(response);
            if (!handledResponse) return;
            
            const blob = await handledResponse.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `transactions-${startDate}-to-${endDate}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error exporting transactions:', error);
            alert('Failed to export transactions. Please try again.');
        }
    });

    // Export to PDF
    document.getElementById('exportPdfBtn').addEventListener('click', async () => {
        try {
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            
            // Get instance name from server
            const configResponse = await fetch(joinPath('api/config'), fetchConfig);
            await handleFetchResponse(configResponse);
            const config = await configResponse.json();
            const instanceName = config.instanceName || 'BudgetBoss';
            
            // Get the current totals
            const response = await fetch(joinPath(`api/totals/range?start=${startDate}&end=${endDate}`), fetchConfig);
            await handleFetchResponse(response);
            const totals = await response.json();
            
            // Get transactions
            const transactionsResponse = await fetch(joinPath(`api/transactions/range?start=${startDate}&end=${endDate}`), fetchConfig);
            await handleFetchResponse(transactionsResponse);
            const transactions = await transactionsResponse.json();
            
            // Create PDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Set font
            doc.setFont('helvetica');
            
            // Add title
            doc.setFontSize(20);
            doc.text(instanceName, 20, 20);
            
            // Add date range
            doc.setFontSize(12);
            doc.text(`Date Range: ${startDate} to ${endDate}`, 20, 30);
            
            // Add totals section
            doc.setFontSize(14);
            doc.text('Summary', 20, 45);
            doc.setFontSize(12);
            doc.text(`Total Income: ${formatCurrency(totals.income)}`, 20, 55);
            doc.text(`Total Expenses: ${formatCurrency(totals.expenses)}`, 20, 65);
            doc.text(`Balance: ${formatCurrency(totals.balance)}`, 20, 75);
            
            // Add transactions table
            const tableData = transactions.map(t => [
                t.date,
                t.description,
                t.category || '-',
                formatCurrency(t.type === 'expense' ? -t.amount : t.amount),
                t.type
            ]);
            
            doc.autoTable({
                startY: 85,
                head: [['Date', 'Description', 'Category', 'Amount', 'Type']],
                body: tableData,
                theme: 'grid',
                headStyles: { fillColor: [66, 66, 66] },
                styles: { fontSize: 10 },
                columnStyles: {
                    0: { cellWidth: 30 }, // Date
                    1: { cellWidth: 60 }, // Description
                    2: { cellWidth: 30 }, // Category
                    3: { cellWidth: 30 }, // Amount
                    4: { cellWidth: 20 }  // Type
                }
            });
            
            // Save the PDF
            doc.save(`transactions-${startDate}-to-${endDate}.pdf`);
            
        } catch (error) {
            console.error('Error exporting to PDF:', error);
            toastManager.show('Failed to export to PDF. Please try again.', 'error');
        }
    });

    // Add filter button handlers
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const filterType = btn.dataset.filter;
            
            // Remove active class from all buttons
            filterButtons.forEach(b => b.classList.remove('active'));
            
            if (currentFilter === filterType) {
                // If clicking the active filter, clear it
                currentFilter = null;
            } else {
                // Set new filter and activate button
                currentFilter = filterType;
                btn.classList.add('active');
            }
            
            loadTransactions();
        });
    });

    // Initialize sort controls
    const sortButtons = document.querySelectorAll('.sort-btn');
    const sortDirection = document.getElementById('sortDirection');

    sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            sortButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            btn.classList.add('active');
            
            currentSortField = btn.dataset.sort;
            loadTransactions();
        });
    });

    sortDirection.addEventListener('click', () => {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
        sortDirection.classList.toggle('descending', currentSortDirection === 'desc');
        loadTransactions();
    });

    // Set initial sort direction indicator
    sortDirection.classList.toggle('descending', currentSortDirection === 'desc');

    // Initial load
    await loadAccounts();
    loadTransactions();
    updateTotals();
}

const registerServiceWorker = () => {
     // Register PWA Service Worker
     if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service-worker.js")
            .then((reg) => console.log("Service Worker registered:", reg.scope))
            .catch((err) => console.log("Service Worker registration failed:", err));
    }
}

async function addAccount(name, type) {
    try {
        const response = await fetch(joinPath('api/accounts'), {
            ...fetchConfig,
            method: 'POST',
            body: JSON.stringify({ name, type })
        });

        await handleFetchResponse(response);
        const newAccount = await response.json();

        await loadAccounts();
        toastManager.show(`Account "${newAccount.name}" added!`, 'success');
    } catch (error) {
        console.error('Error adding account:', error);
        toastManager.show('Error adding account. Please try again.', 'error');
    }
}

async function deleteAccount(id) {
    try {
        const response = await fetch(joinPath(`api/accounts/${id}`), {
            ...fetchConfig,
            method: 'DELETE'
        });
        await handleFetchResponse(response);
        await loadAccounts();
        toastManager.show('Account deleted!', 'success');
    } catch (error) {
        console.error('Error deleting account:', error);
        toastManager.show('Error deleting account. Please try again.', 'error');
    }
}

async function editAccount(id, name, type) {
    try {
        const response = await fetch(joinPath(`api/accounts/${id}`), {
            ...fetchConfig,
            method: 'PUT',
            body: JSON.stringify({ name, type })
        });
        await handleFetchResponse(response);
        await loadAccounts();
        toastManager.show('Conta atualizada!', 'success');
    } catch (error) {
        console.error('Erro ao editar conta:', error);
        toastManager.show('Erro ao editar conta. Tente novamente.', 'error');
    }
}

document.querySelectorAll('.nav-link').forEach(link => {
    const currentPage = window.location.pathname.includes('accounts') ? 'accounts' : window.location.pathname.includes('dashboard') ? 'dashboard' : 'transactions';
    if (link.dataset.page === currentPage) {
        link.classList.add('active');
    }
});

async function populateAccountsSelect() {
  const select = document.getElementById('accountSelect');
  select.innerHTML = '<option value="">Select an Account</option>';

  try {
    const res = await fetch(joinPath('api/accounts'), fetchConfig);
    const accounts = await res.json();

    accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.name} (${acc.type})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Erro ao carregar contas:', err);
    toastManager.show('Erro ao carregar contas', 'error');
  }
}

// Dashboard functionality
async function initDashboard() {
    try {
        // Inicializar componentes comuns
        await fetchCurrentCurrency();
        
        // Configurar seletores de período
        setupPeriodSelector();
        
        // Carregar dados iniciais (mês atual por padrão)
        await loadDashboardData('current-month');
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        toastManager.show('Erro ao inicializar o dashboard. Por favor, recarregue a página.', 'error');
    }
}

function setupPeriodSelector() {
    const periodSelect = document.getElementById('periodSelect');
    const customDateRange = document.getElementById('customDateRange');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const applyButton = document.getElementById('applyDateRange');
    
    // Configurar data atual nos inputs
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    startDateInput.valueAsDate = firstDayOfMonth;
    endDateInput.valueAsDate = today;
    
    // Evento de mudança no seletor de período
    periodSelect.addEventListener('change', function() {
        if (this.value === 'custom') {
            customDateRange.style.display = 'block';
        } else {
            customDateRange.style.display = 'none';
            loadDashboardData(this.value);
        }
    });
    
    // Evento do botão aplicar para período personalizado
    applyButton.addEventListener('click', function() {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;
        
        if (startDate && endDate) {
            loadDashboardData('custom', { startDate, endDate });
        } else {
            toastManager.show('Please select valid dates', 'error');
        }
    });
}

async function loadDashboardData(periodType, customDates) {
    try {
        // Determinar datas com base no período selecionado
        const { startDate, endDate } = calculateDateRange(periodType, customDates);
        
        // Buscar transações no intervalo de datas
        const response = await fetch(joinPath(`api/transactions/range?start=${startDate}&end=${endDate}`), fetchConfig);
        await handleFetchResponse(response);
        const transactions = await response.json();
        
        // Buscar contas
        const accountsResponse = await fetch(joinPath('api/accounts'), fetchConfig);
        await handleFetchResponse(accountsResponse);
        const accounts = await accountsResponse.json();
        
        // Processar dados
        const dashboardData = processDashboardData(transactions, accounts);
        
        // Atualizar UI
        updateDashboardUI(dashboardData);
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        toastManager.show('Erro ao carregar dados do dashboard', 'error');
    }
}

function calculateDateRange(periodType, customDates) {
    const today = new Date();
    let startDate, endDate;
    
    switch (periodType) {
        case 'current-month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = today;
            break;
            
        case 'last-month':
            startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            endDate = new Date(today.getFullYear(), today.getMonth(), 0);
            break;
            
        case 'last-3-months':
            startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            endDate = today;
            break;
            
        case 'last-6-months':
            startDate = new Date(today.getFullYear(), today.getMonth() - 5, 1);
            endDate = today;
            break;
            
        case 'year-to-date':
            startDate = new Date(today.getFullYear(), 0, 1);
            endDate = today;
            break;
            
        case 'last-year':
            startDate = new Date(today.getFullYear() - 1, 0, 1);
            endDate = new Date(today.getFullYear() - 1, 11, 31);
            break;
            
        case 'custom':
            if (customDates) {
                startDate = new Date(customDates.startDate);
                endDate = new Date(customDates.endDate);
            } else {
                startDate = new Date(today.getFullYear(), today.getMonth(), 1);
                endDate = today;
            }
            break;
            
        default:
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = today;
    }
    
    // Formatar datas para YYYY-MM-DD
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0]
    };
}

function processDashboardData(transactions, accounts) {
    // Inicializar objeto de dados
    const data = {
        totalIncome: 0,
        totalExpenses: 0,
        balance: 0,
        categoriesExpenses: {},
        monthlyData: {},
        recentTransactions: [],
        topExpenseCategories: []
    };
    
    // Verificar se transactions u00e9 um array
    if (!Array.isArray(transactions)) {
        console.error('Transactions is not an array:', transactions);
        return data; // Retornar dados vazios
    }
    
    // Processar transau00e7u00f5es
    transactions.forEach(transaction => {
        // Verificar se a transau00e7u00e3o tem os campos necessu00e1rios
        if (!transaction || typeof transaction.amount !== 'number') {
            console.warn('Invalid transaction:', transaction);
            return; // Pular esta transau00e7u00e3o
        }
        
        if (transaction.type === 'income') {
            data.totalIncome += transaction.amount;
        } else {
            data.totalExpenses += transaction.amount;
            
            const category = transaction.category || 'Uncategorized';
            if (!data.categoriesExpenses[category]) {
                data.categoriesExpenses[category] = 0;
            }
            data.categoriesExpenses[category] += transaction.amount;
        }
        
        if (transaction.date && typeof transaction.date === 'string') {
            const month = transaction.date.substring(0, 7);
            if (!data.monthlyData[month]) {
                data.monthlyData[month] = { income: 0, expenses: 0 };
            }
            
            if (transaction.type === 'income') {
                data.monthlyData[month].income += transaction.amount;
            } else {
                data.monthlyData[month].expenses += transaction.amount;
            }
        }
    });
    
    data.balance = data.totalIncome - data.totalExpenses;
    
    data.recentTransactions = [...transactions]
        .filter(t => t && t.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);
    
    data.topExpenseCategories = Object.entries(data.categoriesExpenses)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([category, amount]) => ({ category, amount }));
    
    return data;
}

function updateDashboardUI(data) {
    window.dashboardData = data;
    document.getElementById('totalIncome').textContent = formatCurrency(data.totalIncome);
    document.getElementById('totalExpenses').textContent = formatCurrency(data.totalExpenses);
    
    const balanceElement = document.getElementById('balance');
    balanceElement.textContent = formatCurrency(Math.abs(data.balance));
    if (data.balance < 0) {
        balanceElement.classList.add('negative');
        balanceElement.classList.remove('positive');
    } else {
        balanceElement.classList.add('positive');
        balanceElement.classList.remove('negative');
    }
    
    createIncomeVsExpensesChart(data.totalIncome, data.totalExpenses); 

    createExpensesByCategoryChart(data.categoriesExpenses);
    
    createTrendsChart(data.monthlyData);
    
    updateTopCategoriesList(data.topExpenseCategories);
    
    updateRecentTransactionsList(data.recentTransactions);
}

function createIncomeVsExpensesChart(income, expenses) {
    const ctx = document.getElementById('incomeVsExpensesChart').getContext('2d');
    
    if (window.incomeVsExpensesChart instanceof Chart) {
        window.incomeVsExpensesChart.destroy();
    }
    
    window.incomeVsExpensesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Income', 'Expenses'],
            datasets: [{
                data: [income, expenses],
                backgroundColor: [getCssVar('--success'), getCssVar('--danger')],
                borderColor: [getCssVar('--border'), getCssVar('--border')],
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            layout: {
                padding: 0
              },
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.raw);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        },
                        color: getCssVar('--text')
                    },
                    grid: {
                        color: getCssVar('--border')
                    }
                },
                x: {
                    ticks: {
                        color: getCssVar('--text')
                    },
                    grid: {
                        color: getCssVar('--border')
                    }
                }
            }
        }
    });
}

function createExpensesByCategoryChart(categoriesExpenses) {
    const ctx = document.getElementById('expensesByCategoryChart').getContext('2d');
    
    if (window.expensesByCategoryChart instanceof Chart) {
        window.expensesByCategoryChart.destroy();
    }
    
    const categories = Object.keys(categoriesExpenses);
    const amounts = Object.values(categoriesExpenses);
    
    const backgroundColors = [
        '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
        '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
        '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800'
    ];
    
    window.expensesByCategoryChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: categories,
            datasets: [{
                label: 'Expenses',
                data: amounts,
                backgroundColor: backgroundColors.slice(0, categories.length),
                borderRadius: 6
            }]
        },
        options: {
            layout: {
                padding: 0
            },
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = formatCurrency(context.raw);
                            return `${label}: ${value}`;
                        }
                    }
                },
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: getCssVar('--text')
                    },
                    grid: {
                        color: getCssVar('--border')
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getCssVar('--text')
                    },
                    grid: {
                        color: getCssVar('--border')
                    }
                }
            }
        }
    });
    
}

function createTrendsChart(monthlyData) {
    const ctx = document.getElementById('trendsChart').getContext('2d');
    
    if (window.trendsChart instanceof Chart) {
        window.trendsChart.destroy();
    }
    
    const months = Object.keys(monthlyData).sort();
    
    const incomeData = months.map(month => monthlyData[month].income);
    const expensesData = months.map(month => monthlyData[month].expenses);
    const balanceData = months.map(month => monthlyData[month].income - monthlyData[month].expenses);
    
    const formattedMonths = months.map(month => {
        const [year, monthNum] = month.split('-');
        return `${monthNum}/${year}`;
    });
    
    window.trendsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedMonths,
            datasets: [
                {
                    label: 'Income',
                    data: incomeData,
                    borderColor: getCssVar('--success'),
                    backgroundColor: getCssVar('--success-status-bg'),
                    tension: 0.1,
                    fill: true
                },
                {
                    label: 'Expenses',
                    data: expensesData,
                    borderColor: getCssVar('--danger'),
                    backgroundColor: getCssVar('--danger-status-bg'),
                    tension: 0.1,
                    fill: true
                },
                {
                    label: 'Balance',
                    data: balanceData,
                    borderColor: getCssVar('--primary'),
                    backgroundColor: hexToRgba(getCssVar('--success'), 0.2),
                    tension: 0.1,
                    fill: true
                }
            ]
        },
        options: {
            layout: {
                padding: 0
              },
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            return `${label}: ${formatCurrency(context.raw)}`;
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    align: 'center',
                    labels: {
                        color: getCssVar('--text')
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        },
                        color: getCssVar('--text')
                    },
                    grid: {
                        color: getCssVar('--border')
                    }
                },
                x: {
                    ticks: {
                        color: getCssVar('--text')
                    },
                    grid: {
                        color: getCssVar('--border')
                    }
                }
            }
        }
    });
}

function hexToRgba(hex, alpha = 1) {
    hex = hex.trim();
    if (!hex.startsWith('#')) return hex;
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateTopCategoriesList(topCategories) {
    const listElement = document.getElementById('topExpenseCategories');
    listElement.innerHTML = '';
    
    if (topCategories.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No expenses recorded';
        li.className = 'empty-list-message';
        listElement.appendChild(li);
        return;
    }
    
    topCategories.forEach(item => {
        const li = document.createElement('li');
        li.className = 'dashboard-list-item';
        li.innerHTML = `
            <span class="category-name">${item.category}</span>
            <span class="category-amount expense">${formatCurrency(item.amount)}</span>
        `;
        listElement.appendChild(li);
    });
}

function updateRecentTransactionsList(transactions) {
    const listElement = document.getElementById('recentTransactions');
    listElement.innerHTML = '';
    
    if (transactions.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No transactions recorded';
        li.className = 'empty-list-message';
        listElement.appendChild(li);
        return;
    }
    
    transactions.forEach(transaction => {
        const li = document.createElement('li');
        li.className = 'dashboard-list-item';
        
        const formattedDate = new Date(transaction.date).toLocaleDateString();
        const amountClass = transaction.type === 'income' ? 'income' : 'expense';
        const amountPrefix = transaction.type === 'income' ? '+' : '-';
        
        li.innerHTML = `
            <div class="transaction-info">
                <span class="transaction-date">${formattedDate}</span>
                <span class="transaction-description">${transaction.description}</span>
                ${transaction.category ? `<span class="transaction-category">${transaction.category}</span>` : ''}
            </div>
            <span class="transaction-amount ${amountClass}">${amountPrefix}${formatCurrency(transaction.amount)}</span>
        `;
        listElement.appendChild(li);
    });
}

// Initialize functionality

    initThemeToggle();
    
    // Check which page we're on
    const isLoginPage = window.location.pathname.includes('login');
    const isAccountsPage = window.location.pathname.includes('accounts');
    const isDashboardPage = window.location.pathname.includes('dashboard');
    
    if (isLoginPage) {
        // Only initialize PIN inputs on login page
        setupPinInputs();
    } else if (isAccountsPage) {
        // Initialize accounts page functionality
        initAccountModalHandling();
        initAccountsPage();
    } else if (isDashboardPage) {
        // Initialize dashboard page functionality
        initDashboard();
    } else {
        // Only initialize main page functionality when not on login
        initTransactionModalHandling();
        initMainPage();
    }

    registerServiceWorker();
