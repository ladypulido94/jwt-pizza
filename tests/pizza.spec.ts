import { Page } from "@playwright/test";
import { test, expect } from "playwright-test-coverage";
import { Role, User } from "../src/service/pizzaService";

async function basicInit(page: Page) {
  let loggedInUser: User | undefined;
  const validUsers: Record<string, User> = {
    "ladyp@byu.edu": {
      id: "4",
      name: "Lady Pulido",
      email: "ladyp@byu.edu",
      password: "123",
      roles: [{ role: Role.Diner }, { role: Role.Franchisee, objectId: "6" }],
    },
    "a@jwt.com": {
      id: "1",
      name: "常用名字",
      email: "a@jwt.com",
      password: "admin",
      roles: [{ role: Role.Admin }],
    },
    "d@jwt.com": {
      id: "3",
      name: "Kai Chen",
      email: "d@jwt.com",
      password: "a",
      roles: [{ role: Role.Diner }],
    },
  };

  await page.route("*/**/api/auth", async (route) => {
    const method = route.request().method();

    if (method === "POST") {
      // Register a user using the submitted form values.
      const registration = route.request().postDataJSON();
      expect(registration).toMatchObject({
        name: expect.any(String),
        email: expect.any(String),
        password: expect.any(String),
      });
      loggedInUser = {
        id: "4",
        name: registration.name,
        email: registration.email,
        password: registration.password,
        roles: [{ role: Role.Diner }],
      };
      validUsers[registration.email] = loggedInUser;
      await route.fulfill({ json: { user: loggedInUser, token: "abcdef" } });
    } else if (method === "PUT") {
      // Log in with an existing mock user.
      const loginReq = route.request().postDataJSON();
      const user = validUsers[loginReq.email];
      if (!user || user.password !== loginReq.password) {
        await route.fulfill({ status: 401, json: { message: "Unauthorized" } });
        return;
      }
      loggedInUser = user;
      await route.fulfill({ json: { user: loggedInUser, token: "abcdef" } });
    } else if (method === "DELETE") {
      loggedInUser = undefined;
      await route.fulfill({ json: {} });
    } else {
      throw new Error(`Unexpected auth method: ${method}`);
    }
  });

  await page.route("*/**/api/user/me", async (route) => {
    expect(route.request().method()).toBe("GET");
    if (!loggedInUser) {
      await route.fulfill({ status: 401, json: { message: "Unauthorized" } });
      return;
    }
    await route.fulfill({ json: loggedInUser });
  });

  await page.route("*/**/api/order/menu", async (route) => {
    const menuRes = [
      {
        id: 1,
        title: "Veggie",
        image: "pizza1.png",
        price: 0.0038,
        description: "A garden of delight",
      },
      {
        id: 2,
        title: "Pepperoni",
        image: "pizza2.png",
        price: 0.0042,
        description: "Spicy treat",
      },
    ];
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: menuRes });
  });

  const franchiseRes = {
    more: false,
    franchises: [
      {
        id: 2,
        name: "LotaPizza",
        stores: [
          { id: 4, name: "Lehi" },
          { id: 5, name: "Springville" },
          { id: 6, name: "American Fork" },
        ],
      },
      { id: 3, name: "PizzaCorp", stores: [{ id: 7, name: "Spanish Fork" }] },
      { id: 4, name: "topSpot", stores: [] },
      {
        id: 6,
        name: "Playwright",
        admins: [{ id: "4", name: "Lady Pulido", email: "ladyp@byu.edu" }],
        stores: [],
      },
      {
        id: 5,
        name: "pizzaPocket",
        admins: [{ id: "2", name: "pizza franchisee", email: "f@jwt.com" }],
        stores: [{ id: 8, name: "SLC", totalRevenue: 0.09 }],
      },
    ],
  };
  await page.route(/\/api\/franchise(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      const request = route.request().postDataJSON();
      expect(request).toMatchObject({
        name: expect.any(String),
        admins: [{ email: expect.any(String) }],
        stores: [],
      });
      const franchise = {
        ...request,
        id: Math.max(...franchiseRes.franchises.map((f) => f.id)) + 1,
        admins: request.admins.map((admin: { email: string }) => ({
          email: admin.email,
          id: validUsers[admin.email]?.id,
          name: validUsers[admin.email]?.name,
        })),
      };
      franchiseRes.franchises.push(franchise);
      await route.fulfill({ json: franchise });
      return;
    }
    expect(route.request().method()).toBe("GET");
    await route.fulfill({ json: franchiseRes });
  });

  await page.route(/\/api\/franchise\/[^/]+$/, async (route) => {
    expect(route.request().method()).toBe("GET");
    const userId = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({
      json: franchiseRes.franchises.filter((franchise) =>
        franchise.admins?.some((admin) => admin.id === userId),
      ),
    });
  });

  await page.route(/\/api\/franchise\/[^/]+\/store$/, async (route) => {
    expect(route.request().method()).toBe("POST");
    const franchiseId = new URL(route.request().url()).pathname.split("/")[3];
    const franchise = franchiseRes.franchises.find(
      (f) => String(f.id) === franchiseId,
    );
    expect(franchise).toBeDefined();
    const request = route.request().postDataJSON();
    expect(request).toMatchObject({ id: "", name: expect.any(String) });
    const store = {
      ...request,
      id:
        Math.max(
          0,
          ...franchiseRes.franchises.flatMap((f) => f.stores.map((s) => s.id)),
        ) + 1,
      totalRevenue: 0,
    };
    franchise!.stores.push(store);
    await route.fulfill({ json: store });
  });

  await page.route("*/**/api/order", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          id: "1",
          dinerId: loggedInUser?.id,
          orders:
            loggedInUser?.id === "1"
              ? [
                  {
                    id: "22",
                    franchiseId: "5",
                    storeId: "8",
                    date: "2026-10-07",
                    items: [
                      { menuId: "1", description: "Veggie", price: 0.01 },
                    ],
                  },
                ]
              : [],
        },
      });
      return;
    }
    const orderReq = route.request().postDataJSON();
    const orderRes = {
      order: { ...orderReq, id: 23 },
      jwt: "eyJpYXQ",
    };
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: orderRes });
  });

  await page.goto("/");
}

test("login", async ({ page }) => {
  await basicInit(page);
  await page.getByRole("link", { name: "Login" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("d@jwt.com");
  await page.getByRole("textbox", { name: "Password" }).fill("a");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("link", { name: "KC" })).toBeVisible();
});

test("purchase with login", async ({ page }) => {
  await basicInit(page);

  await page.getByRole("button", { name: "Order now" }).click();

  await expect(page.locator("h2")).toContainText("Awesome is a click away");
  await page.getByRole("combobox").selectOption("4");
  await page.getByRole("link", { name: "Image Description Veggie A" }).click();
  await page.getByRole("link", { name: "Image Description Pepperoni" }).click();
  await expect(page.locator("form")).toContainText("Selected pizzas: 2");
  await page.getByRole("button", { name: "Checkout" }).click();

  await page.getByPlaceholder("Email address").fill("d@jwt.com");
  await page.getByPlaceholder("Password").fill("a");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByRole("main")).toContainText(
    "Send me those 2 pizzas right now!",
  );
  await expect(page.locator("tbody")).toContainText("Veggie");
  await expect(page.locator("tbody")).toContainText("Pepperoni");
  await expect(page.locator("tfoot")).toContainText("0.008 ₿");
  await page.getByRole("button", { name: "Pay now" }).click();

  await expect(page.getByText("0.008")).toBeVisible();
});

test("register", async ({ page }) => {
  await basicInit(page);
  await page.getByRole("link", { name: "Register" }).click();
  await expect(page.getByRole("heading")).toContainText("Welcome to the party");
  await page.getByPlaceholder("Full name", { exact: true }).fill("Lady Pulido");
  await page
    .getByPlaceholder("Email address", { exact: true })
    .fill("ladyp@byu.edu");
  await page.getByLabel("Password", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Register" }).click();
  await page.getByRole("link", { name: "LP", exact: true }).click();
  await expect(page.getByRole("heading")).toContainText("Your pizza kitchen");
  await expect(page.getByRole("main")).toContainText("Lady Pulido");
  await expect(page.getByRole("main")).toContainText("ladyp@byu.edu");
  await expect(page.getByRole("main")).toContainText("diner");
});

test("admin dashboard", async ({ page }) => {
  await basicInit(page);
  await page.getByRole("link", { name: "Login" }).click();
  await page.getByRole("textbox", { name: "Email address" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("a@jwt.com");
  await page.getByRole("textbox", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Password" }).fill("admin");
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("link", { name: "常", exact: true }).click();
  await expect(page.getByRole("heading")).toContainText("Your pizza kitchen");
  await expect(page.getByRole("main")).toContainText("a@jwt.com");
  await expect(page.getByRole("main")).toContainText("admin");
  await expect(page.locator("tbody")).toContainText("0.01 ₿");
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.locator("h2")).toContainText("Mama Ricci's kitchen");
  await expect(page.locator("h3")).toContainText("Franchises");
  await expect(
    page.getByRole("row").filter({ hasText: "pizzaPocket" }),
  ).toContainText("pizza franchisee");
  await expect(page.locator("thead")).toContainText("Franchise");
  await expect(
    page.getByRole("cell", { name: "pizzaPocket", exact: true }),
  ).toBeVisible();
  await expect(page.locator("thead")).toContainText("Store");
  await expect(page.getByRole("row").filter({ hasText: "SLC" })).toBeVisible();
  await expect(page.locator("thead")).toContainText("Revenue");
  await expect(page.getByRole("row").filter({ hasText: "SLC" })).toContainText(
    "0.09 ₿",
  );
});

test("create franchise", async ({ page }) => {
  await basicInit(page);
  await page.getByRole("link", { name: "Login" }).click();
  await page.getByRole("textbox", { name: "Email address" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("a@jwt.com");
  await page.getByRole("textbox", { name: "Password" }).click();
  await page.getByRole("textbox", { name: "Password" }).fill("admin");
  await page.getByRole("textbox", { name: "Password" }).press("Enter");
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.locator("h2")).toContainText("Mama Ricci's kitchen");
  await expect(page.getByRole("main")).toContainText("Add Franchise");
  await page.getByRole("button", { name: "Add Franchise" }).click();
  await expect(page.getByRole("heading")).toContainText("Create franchise");
  await page.getByRole("textbox", { name: "franchise name" }).click();
  await page
    .getByRole("textbox", { name: "franchise name" })
    .fill("New Playwright");
  await page.getByRole("textbox", { name: "franchisee admin email" }).click();
  await page
    .getByRole("textbox", { name: "franchisee admin email" })
    .fill("a@jwt.com");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("thead")).toContainText("Franchise");
  await expect(page.getByRole("table")).toContainText("New Playwright");
  await expect(page.locator("thead")).toContainText("Franchisee");
  await expect(
    page.getByRole("row").filter({ hasText: "New Playwright" }),
  ).toContainText("常用名字");
  await expect(page.locator("h2")).toContainText("Mama Ricci's kitchen");
});

test("franchise login and create store", async ({ page }) => {
  await basicInit(page);
  await page
    .getByRole("navigation", { name: "Global" })
    .getByRole("link", { name: "Franchise" })
    .click();
  await expect(page.getByRole("main")).toContainText(
    "So you want a piece of the pie?",
  );
  await expect(page.getByRole("alert")).toContainText(
    "If you are already a franchisee, pleaseloginusing your franchise account",
  );
  await page.getByRole("link", { name: "login", exact: true }).click();
  await page.getByRole("textbox", { name: "Email address" }).click();
  await page
    .getByRole("textbox", { name: "Email address" })
    .fill("ladyp@byu.edu");
  await page.getByRole("textbox", { name: "Email address" }).press("Tab");
  await page.getByRole("textbox", { name: "Password" }).fill("123");
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("heading")).toContainText("Playwright");
  await expect(page.getByRole("main")).toContainText(
    "Everything you need to run an JWT Pizza franchise. Your gateway to success.",
  );
  await page.getByRole("button", { name: "Create store" }).click();
  await page.getByRole("textbox", { name: "store name" }).click();
  await page.getByRole("textbox", { name: "store name" }).fill("Provo");
  await expect(page.getByRole("heading")).toContainText("Create store");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("thead")).toContainText("Name");
  await expect(page.locator("tbody")).toContainText("Provo");
  await expect(page.locator("thead")).toContainText("Revenue");
  await expect(
    page.getByRole("row").filter({ hasText: "Provo" }),
  ).toContainText("0 ₿");
});

test("logout", async ({ page }) => {
    await basicInit(page);
    await page.getByRole('link', { name: 'Login' }).click();
    await page.getByRole('textbox', { name: 'Email address' }).fill('ladyp@byu.edu');
    await page.getByRole('textbox', { name: 'Email address' }).press('Tab');
    await page.getByRole('textbox', { name: 'Password' }).fill('123');
    await page.getByRole('textbox', { name: 'Password' }).press('Enter');
    await page.getByRole('link', { name: 'LP' }).click();
    await expect(page.getByRole('heading')).toContainText('Your pizza kitchen');
    await expect(page.getByRole('main')).toContainText('name:');
    await expect(page.getByRole('main')).toContainText('Lady Pulido');
    await expect(page.locator('#navbar-dark')).toContainText('OrderFranchiseLogout');
    const logoutResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/auth" &&
      response.request().method() === "DELETE",
    );
    await page.getByRole('link', { name: 'Logout' }).click();
    expect((await logoutResponse).status()).toBe(200);
    await expect(page.getByRole('link', { name: 'Login', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'LP', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    await expect(page.getByRole('heading')).toContainText('The web\'s best pizza');
});
